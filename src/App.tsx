/**
 * Undesign application shell over the engine store. Owns panel visibility,
 * global shortcuts, the fullscreen preview, and the notice toast. All
 * editing state lives in the engine; this file holds UI state only.
 */
import { useEffect, useState } from 'react';
import { EngineProvider, useEngine } from './engine/store';
import { TopToolbar } from './components/TopToolbar';
import { EngineSidebar } from './components/EngineSidebar';
import { EngineCanvas } from './components/EngineCanvas';
import { EngineInspector } from './components/EngineInspector';
import { EngineLab } from './components/EngineLab';

export default function App() {
  return (
    <EngineProvider>
      <Shell />
    </EngineProvider>
  );
}

function Shell() {
  const ed = useEngine();
  const [preview, setPreview] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const [leftVisible, setLeftVisible] = useState(() => window.innerWidth > 900);
  const [rightVisible, setRightVisible] = useState(() => window.innerWidth > 1100);

  useEffect(() => {
    if (!ed.notice) return;
    const t = window.setTimeout(() => ed.dismissNotice(), 6000);
    return () => window.clearTimeout(t);
  }, [ed.notice, ed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.tagName === 'SELECT');
      const modalOpen = document.querySelector('.modal-overlay') !== null;
      if (e.key === 'Escape') {
        if (preview) {
          setPreview(false);
          return;
        }
        if (typing || modalOpen) return; // inputs and modals handle their own Escape
        if (document.querySelector('.menu-drop, .ctx-menu') !== null) return;
        if (ed.tool !== 'select') ed.setTool('select');
        else ed.clearSelection();
        return;
      }
      if (typing || modalOpen || preview) return;
      if (document.querySelector('.menu-drop') !== null) return;
      if (ed.status !== 'ready') return;

      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if ((e.key === 'Delete' || e.key === 'Backspace') && ed.snapshot.selection.length > 0) {
        e.preventDefault();
        ed.removeSelected();
        return;
      }
      if (mod && k === 'd') {
        e.preventDefault();
        ed.duplicateSelected();
        return;
      }
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        ed.undo();
        return;
      }
      if ((mod && k === 'y') || (mod && k === 'z' && e.shiftKey)) {
        e.preventDefault();
        ed.redo();
        return;
      }
      if (mod && k === 'x') {
        e.preventDefault();
        ed.cutSelected();
        return;
      }
      if (mod && k === 'c') {
        e.preventDefault();
        ed.copySelected();
        return;
      }
      if (mod && k === 'v') {
        e.preventDefault();
        ed.pasteAtCenter();
        return;
      }
      if (mod && k === 'a') {
        e.preventDefault();
        ed.selectAll();
        return;
      }
      if (mod && k === 'g' && !e.shiftKey) {
        e.preventDefault();
        ed.groupSelected();
        return;
      }
      if (mod && k === 'g' && e.shiftKey) {
        e.preventDefault();
        ed.ungroupSelected();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        ed.moveSelected(dx, dy);
        return;
      }
      if (mod && (k === '=' || k === '+')) {
        e.preventDefault();
        ed.zoomIn();
        return;
      }
      if (mod && k === '-') {
        e.preventDefault();
        ed.zoomOut();
        return;
      }
      if (mod && k === '0') {
        e.preventDefault();
        ed.zoomReset();
        return;
      }
      if (e.shiftKey && (e.key === '!' || k === '1')) {
        e.preventDefault();
        ed.zoomFit();
        return;
      }
      if (e.key === '[') {
        ed.sendBackward();
        return;
      }
      if (e.key === ']') {
        ed.bringForward();
        return;
      }
      if (mod || e.altKey) return;
      const tools = { v: 'select', h: 'hand', f: 'frame', r: 'rectangle', o: 'ellipse', t: 'text', l: 'line' } as const;
      if (k in tools) {
        ed.setTool(tools[k as keyof typeof tools]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ed, preview]);

  const pageName = ed.snapshot.pages.find((p) => p.id === ed.snapshot.activePageId)?.name ?? '';

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
        {leftVisible && <EngineSidebar />}
        {labOpen ? <EngineLab /> : <EngineCanvas />}
        {rightVisible && <EngineInspector />}
      </div>
      {ed.notice && (
        <div className="notice-toast" role="status">
          <span>{ed.notice}</span>
          <button className="mini-btn" onClick={ed.dismissNotice} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      {preview && (
        <div className="preview-overlay" onClick={() => setPreview(false)}>
          <div className="preview-bar">
            <span>{pageName}</span>
            <span className="dim small">Fullscreen render · prototype navigation arrives in a later milestone · Esc to exit</span>
          </div>
          {ed.snapshot.svg !== '' && (
            <div className="preview-stage" dangerouslySetInnerHTML={{ __html: ed.snapshot.svg }} />
          )}
        </div>
      )}
    </div>
  );
}
