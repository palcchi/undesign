import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useEditor } from '../store';

/* ---------- Modal dialog ---------- */

export function Modal({
  title,
  onClose,
  children,
  width = 440,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Context menu ---------- */

export interface CtxItem {
  label?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  onSelect?: () => void;
}

export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: CtxItem[] } | null>(null);
  const open = useCallback((x: number, y: number, items: CtxItem[]) => {
    setMenu({ x, y, items });
  }, []);
  const close = useCallback(() => setMenu(null), []);
  return { menu, open, close };
}

export function ContextMenu({
  menu,
  onClose,
}: {
  menu: { x: number; y: number; items: CtxItem[] } | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onScroll, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onScroll, true);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  const x = Math.min(menu.x, window.innerWidth - 220);
  const y = Math.min(menu.y, window.innerHeight - menu.items.length * 30 - 16);
  return (
    <div ref={ref} className="ctx-menu" style={{ left: x, top: y }} role="menu">
      {menu.items.map((item, i) =>
        item.divider ? (
          <div key={i} className="ctx-divider" />
        ) : (
          <button
            key={i}
            className={`ctx-item${item.danger ? ' danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="ctx-shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/* ---------- Small helpers ---------- */

/** Fires onCmd when Enter is pressed, onCancel on Escape. */
export function useEnterEscape(onCommit: () => void, onCancel: () => void) {
  return {
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    },
  };
}

/**
 * Ends the transient session when a native color picker closes (it fires
 * 'change' once on close; per-tick input arrives via React onChange).
 */
export function useNativePickerEnd(ref: React.RefObject<HTMLInputElement>) {
  const { endTransient } = useEditor();
  const endRef = useRef(endTransient);
  endRef.current = endTransient;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onNativeChange = () => endRef.current();
    el.addEventListener('change', onNativeChange);
    return () => el.removeEventListener('change', onNativeChange);
  }, [ref]);
}
