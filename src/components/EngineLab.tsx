/**
 * Engine Lab: working proof that the FigCraft-derived WASM engine runs
 * inside Undesign. Every control below operates on the engine's own
 * document state through the JSON boundary in `rust/src/lib.rs` — nothing
 * here touches the TypeScript document model.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadWasmEngine, parseUndoDepth, type WasmEngineInstance } from '../wasm/engine';

type Status = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };

const FILLS = ['#0D99FF', '#FF4D00', '#14AE5C', '#FFCD29', '#9747FF'];

export function EngineLab() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [svg, setSvg] = useState('');
  const [info, setInfo] = useState('{}');
  const [depth, setDepth] = useState<[number, number]>([0, 0]);
  const [selection, setSelection] = useState('[]');
  const [log, setLog] = useState<string[]>([]);
  const [saved, setSaved] = useState('');
  const engineRef = useRef<WasmEngineInstance | null>(null);
  const spots = useRef({ x: 10, n: 0 });
  const lastX = useRef(new Map<number, number>());

  const refresh = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    try {
      setSvg(e.exportPageSvg());
    } catch {
      setSvg('');
    }
    setInfo(e.docInfo());
    setDepth(parseUndoDepth(e.undoDepth()));
    setSelection(e.selection());
  }, []);

  useEffect(() => {
    let alive = true;
    loadWasmEngine()
      .then(({ engine }) => {
        if (!alive) return;
        engineRef.current = engine;
        setStatus({ kind: 'ready' });
        setSvg(engine.exportPageSvg());
        setInfo(engine.docInfo());
        setDepth(parseUndoDepth(engine.undoDepth()));
        setSelection(engine.selection());
      })
      .catch((e: unknown) => {
        if (alive) setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      alive = false;
    };
  }, []);

  const run = (label: string, fn: (e: WasmEngineInstance) => string) => {
    const e = engineRef.current;
    if (!e) return;
    try {
      const out = fn(e);
      setLog((l) => [`${label} → ${out}`, ...l].slice(0, 8));
    } catch (err) {
      setLog((l) => [`${label} ✕ ${err instanceof Error ? err.message : String(err)}`, ...l].slice(0, 8));
    }
    refresh();
  };

  const addRect = () =>
    run('shape.rectangle', (e) => {
      const s = spots.current;
      const out = e.execute(
        'shape.rectangle',
        JSON.stringify({
          x: s.x,
          y: 20,
          width: 100,
          height: 60,
          props: { fill: FILLS[s.n % FILLS.length] },
        }),
      );
      const id = (JSON.parse(out) as { id: number }).id;
      lastX.current.set(id, s.x);
      s.x += 120;
      s.n += 1;
      return out;
    });

  const moveSelected = () =>
    run('node.set', (e) => {
      const ids = JSON.parse(e.selection()) as number[];
      if (ids.length === 0) throw new Error('nothing selected — add a rectangle first');
      const id = ids[0];
      const x = (lastX.current.get(id) ?? 10) + 20;
      lastX.current.set(id, x);
      return e.execute('node.set', JSON.stringify({ id, props: { x } }));
    });

  return (
    <div className="lab">
      <div className="lab-stage">
        {status.kind === 'loading' && <p className="dim">Loading the WASM engine…</p>}
        {status.kind === 'error' && (
          <div className="lab-error" role="alert">
            <p>
              <strong>Engine failed to load.</strong>
            </p>
            <p className="dim">{status.message}</p>
          </div>
        )}
        {status.kind === 'ready' && svg !== '' && (
          <div className="lab-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        )}
        {status.kind === 'ready' && svg === '' && <p className="dim">The page is empty — add a rectangle.</p>}
      </div>
      <div className="lab-side">
        <div className="prop-section">
          <div className="prop-title">WASM engine</div>
          <div className="lab-status">
            <span className={`lab-dot ${status.kind}`} aria-hidden="true" />
            <span>
              {status.kind === 'loading' && 'Loading…'}
              {status.kind === 'ready' && 'Ready — FigCraft session live'}
              {status.kind === 'error' && 'Failed to load'}
            </span>
          </div>
          <div className="prop-hint">
            Doc <code>{prettyInfo(info)}</code> · undo {depth[0]} / redo {depth[1]} · selection{' '}
            <code>{selection}</code>
          </div>
        </div>
        <div className="prop-section">
          <div className="prop-title">Edit</div>
          <div className="lab-buttons">
            <button className="btn secondary" disabled={status.kind !== 'ready'} onClick={addRect}>
              Add rectangle
            </button>
            <button className="btn secondary" disabled={status.kind !== 'ready'} onClick={moveSelected}>
              Move +20
            </button>
            <button
              className="btn secondary"
              disabled={status.kind !== 'ready' || depth[0] === 0}
              onClick={() => run('undo', (e) => String(e.undo()))}
            >
              Undo
            </button>
            <button
              className="btn secondary"
              disabled={status.kind !== 'ready' || depth[1] === 0}
              onClick={() => run('redo', (e) => String(e.redo()))}
            >
              Redo
            </button>
          </div>
        </div>
        <div className="prop-section">
          <div className="prop-title">Serialize</div>
          <div className="lab-buttons">
            <button
              className="btn secondary"
              disabled={status.kind !== 'ready'}
              onClick={() => run('save', (e) => {
                const json = e.save();
                setSaved(json);
                return `${json.length} bytes`;
              })}
            >
              Save to JSON
            </button>
            <button
              className="btn secondary"
              disabled={status.kind !== 'ready' || saved === ''}
              onClick={() => run('load', (e) => {
                e.load(saved);
                return 'document replaced (history reset)';
              })}
            >
              Load JSON
            </button>
          </div>
          <textarea
            className="text-input lab-json"
            value={saved}
            rows={4}
            spellCheck={false}
            placeholder="Saved document JSON appears here"
            onChange={(e) => setSaved(e.target.value)}
            aria-label="Saved document JSON"
          />
        </div>
        <div className="prop-section">
          <div className="prop-title">Log</div>
          {log.length === 0 ? (
            <p className="dim small">Commands and results appear here.</p>
          ) : (
            <pre className="lab-log">{log.join('\n')}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

function prettyInfo(raw: string): string {
  try {
    const v = JSON.parse(raw) as { name?: string; nodes?: number; pages?: number };
    return `${v.name ?? '?'} · ${v.nodes ?? 0} nodes · ${v.pages ?? 0} pages`;
  } catch {
    return raw;
  }
}
