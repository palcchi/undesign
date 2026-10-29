/**
 * Floating bottom tool palette (FigCraft UI3 arrangement, Undesign chrome):
 * grouped tools with flyouts and a remembered last tool per group. Only
 * tools the canvas actually implements are offered — no dead entries.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ChevronUp,
  Circle,
  Frame,
  Hand,
  Hexagon,
  Minus,
  MousePointer2,
  Square,
  Star,
  Type,
} from 'lucide-react';
import { useEngine } from '../engine/store';
import type { Tool } from '../types';

interface PaletteTool {
  id: Tool;
  icon: React.ReactNode;
  label: string;
  key?: string;
}

interface PaletteGroup {
  key: string;
  name: string;
  tools: PaletteTool[];
}

const GROUPS: PaletteGroup[] = [
  {
    key: 'move',
    name: 'Move tools',
    tools: [
      { id: 'select', icon: <MousePointer2 size={17} />, label: 'Select', key: 'V' },
      { id: 'hand', icon: <Hand size={17} />, label: 'Pan', key: 'H' },
    ],
  },
  {
    key: 'frame',
    name: 'Frame',
    tools: [{ id: 'frame', icon: <Frame size={17} />, label: 'Frame', key: 'F' }],
  },
  {
    key: 'shape',
    name: 'Shape tools',
    tools: [
      { id: 'rectangle', icon: <Square size={17} />, label: 'Rectangle', key: 'R' },
      { id: 'ellipse', icon: <Circle size={17} />, label: 'Ellipse', key: 'O' },
      { id: 'polygon', icon: <Hexagon size={17} />, label: 'Polygon', key: 'P' },
      { id: 'star', icon: <Star size={17} />, label: 'Star' },
      { id: 'line', icon: <Minus size={17} />, label: 'Line', key: 'L' },
      { id: 'arrow', icon: <ArrowUpRight size={17} />, label: 'Arrow' },
    ],
  },
  {
    key: 'text',
    name: 'Text',
    tools: [{ id: 'text', icon: <Type size={17} />, label: 'Text', key: 'T' }],
  },
];

export function ToolPalette() {
  const ed = useEngine();
  const [open, setOpen] = useState<string | null>(null);
  const [remembered, setRemembered] = useState<Record<string, Tool>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    // Capture phase: closing the flyout must not also clear the selection
    // through the app-level Escape handler.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(null);
      }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open ]);

  if (ed.status !== 'ready') return null;

  const pick = (group: PaletteGroup, tool: Tool) => {
    setRemembered((r) => ({ ...r, [group.key]: tool }));
    ed.setTool(tool);
    setOpen(null);
  };

  const swallow = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <div
      ref={rootRef}
      className="tool-palette"
      role="toolbar"
      aria-label="Tools"
      onPointerDown={swallow}
      onPointerMove={swallow}
      onPointerUp={swallow}
    >
      {GROUPS.map((g) => {
        const current = g.tools.find((t) => t.id === (remembered[g.key] ?? g.tools[0].id)) ?? g.tools[0];
        const active = g.tools.some((t) => t.id === ed.tool);
        const flyout = g.tools.length > 1;
        return (
          <div key={g.key} className="palette-group">
            <button
              className={`palette-btn${active ? ' active' : ''}`}
              data-tip={flyout ? `${g.name} (current: ${current.label})` : `${current.label}${current.key ? ` (${current.key})` : ''}`}
              aria-label={current.label}
              aria-pressed={ed.tool === current.id}
              onClick={() => pick(g, current.id)}
            >
              {current.icon}
            </button>
            {flyout && (
              <button
                className={`palette-caret${open === g.key ? ' open' : ''}`}
                data-tip={`${g.name}: all tools`}
                aria-label={`${g.name}: all tools`}
                aria-expanded={open === g.key}
                onClick={() => setOpen(open === g.key ? null : g.key)}
              >
                <ChevronUp size={12} />
              </button>
            )}
            {flyout && open === g.key && (
              <div className="palette-flyout" role="menu" aria-label={g.name}>
                {g.tools.map((t) => (
                  <button
                    key={t.id}
                    className={`palette-flyitem${ed.tool === t.id ? ' active' : ''}`}
                    role="menuitemradio"
                    aria-checked={ed.tool === t.id}
                    onClick={() => pick(g, t.id)}
                  >
                    <span className="palette-flyicon">{t.icon}</span>
                    <span className="palette-flylabel">{t.label}</span>
                    {t.key && <span className="palette-flykey">{t.key}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
