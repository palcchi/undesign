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
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // Keep Tab cycling inside the dialog while it is open.
      if (e.key === 'Tab' && dialogRef.current) {
        const items = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Move focus into the dialog on open and restore the trigger on close.
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = dialogRef.current?.querySelector<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select, textarea, a[href]',
    );
    (target ?? dialogRef.current)?.focus();
    return () => prev?.focus();
  }, []);

  return (
    <div
      className="modal-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
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
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && ref.current) {
        const items = Array.from(ref.current.querySelectorAll<HTMLButtonElement>('.ctx-item:not(:disabled)'));
        if (items.length === 0) return;
        e.preventDefault();
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? items[(at + 1) % items.length] : items[(at - 1 + items.length) % items.length];
        next.focus();
      }
    };
    const onScroll = () => onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [menu, onClose]);

  useEffect(() => {
    if (menu) ref.current?.querySelector<HTMLButtonElement>('.ctx-item:not(:disabled)')?.focus();
  }, [menu]);

  if (!menu) return null;
  const x = Math.max(8, Math.min(menu.x, window.innerWidth - 220));
  const y = Math.max(8, Math.min(menu.y, window.innerHeight - menu.items.length * 30 - 16));
  return (
    <div ref={ref} className="ctx-menu" style={{ left: x, top: y }} role="menu">
      {menu.items.map((item, i) =>
        item.divider ? (
          <div key={i} className="ctx-divider" />
        ) : (
          <button
            key={i}
            role="menuitem"
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
