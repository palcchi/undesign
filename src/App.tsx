import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { EditorProvider, useEditor } from './store';
import { TopToolbar } from './components/TopToolbar';
import { LeftSidebar } from './components/LeftSidebar';
import { CanvasView } from './components/CanvasView';
import { PropertiesPanel } from './components/PropertiesPanel';
import { pageToSvg } from './utils';

export default function App() {
  return (
    <EditorProvider>
      <Shell />
    </EditorProvider>
  );
}

function Shell() {
  const [preview, setPreview] = useState(false);
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
      />
      <div className="workbench">
        {leftVisible && <LeftSidebar />}
        <CanvasView />
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
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      const modalOpen = document.querySelector('.modal-overlay') !== null;

      if (e.key === 'Escape') {
        if (previewOpen) {
          closePreview();
          return;
        }
        if (typing || modalOpen) return; // inputs and modals handle their own Escape
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

function PreviewOverlay({ onClose }: { onClose: () => void }) {
  const { page } = useEditor();
  const [svg, setSvg] = useState('');

  useEffect(() => {
    setSvg(pageToSvg(page));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, onClose]);

  return (
    <div className="preview-overlay" onClick={onClose} role="dialog" aria-label="Preview">
      <div className="preview-bar">
        <span>{page.name}</span>
        <span className="dim">Click anywhere or press Esc to exit</span>
      </div>
      <div className="preview-stage" onClick={(e) => e.stopPropagation()}>
        {/* Generated from the live document model — no external content. */}
        <div className="preview-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </div>
  );
}
