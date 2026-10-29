/**
 * Typed application adapter over the WASM engine handle. The engine owns the
 * document; this class is the only code allowed to cross the JSON boundary
 * for main-editor operations. Every method parses engine JSON into typed
 * structures (throwing EngineError on malformed output) so UI code never
 * touches raw engine payloads.
 *
 * Command names and params mirror the real engine registry (verified in
 * `cargo test`, especially `migration_script_builds_a_full_page`).
 */
import type { WasmEngineInstance } from '../wasm/engine';

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

export interface EnginePaint {
  type: string;
  color?: string;
  opacity?: number;
}

export interface EngineBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One node of the engine tree, with engine defaults normalized. */
export interface EngineNode {
  id: number;
  name: string;
  /** PAGE | FRAME | GROUP | RECTANGLE | ELLIPSE | LINE | TEXT | ... */
  type: string;
  /** Position relative to the parent (absent on pages). */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  absoluteBounds: EngineBounds | null;
  visible: boolean;
  locked: boolean;
  opacity: number;
  fills: EnginePaint[];
  strokes: EnginePaint[];
  strokeWeight: number;
  cornerRadius: number | number[] | null;
  /** Frames clip content (node_json reports it on frame-likes). */
  clip: boolean;
  /** Text nodes. */
  characters: string | null;
  fontFamily: string | null;
  fontStyle: string | null;
  fontSize: number | null;
  textAlign: string | null;
  /** Leading label as reported ("Auto", "140%", or px). */
  lineHeight: string | null;
  children: EngineNode[];
  /** Present instead of children when describe depth ran out. */
  childCount: number | null;
}

export interface EnginePage {
  id: number;
  name: string;
  current: boolean;
  children: number;
}

export interface EngineHit {
  id: number;
  name: string;
  type: string;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function paints(v: unknown): EnginePaint[] {
  if (!Array.isArray(v)) return [];
  const out: EnginePaint[] = [];
  for (const p of v) {
    if (typeof p !== 'object' || p === null) continue;
    const r = p as Record<string, unknown>;
    if (typeof r.type !== 'string') continue;
    out.push({
      type: r.type,
      color: typeof r.color === 'string' ? r.color : undefined,
      opacity: typeof r.opacity === 'number' ? r.opacity : undefined,
    });
  }
  return out;
}

function bounds(v: unknown): EngineBounds | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (![r.x, r.y, r.width, r.height].every((n) => typeof n === 'number')) return null;
  return { x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number };
}

/** Normalize one raw node_json payload; throws EngineError on bad shape. */
export function parseEngineNode(raw: unknown): EngineNode {
  if (typeof raw !== 'object' || raw === null) throw new EngineError('engine returned no node');
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'number' || typeof r.type !== 'string') {
    throw new EngineError('engine node is missing id/type');
  }
  let cornerRadius: number | number[] | null = null;
  if (typeof r.cornerRadius === 'number') cornerRadius = r.cornerRadius;
  else if (Array.isArray(r.cornerRadius) && r.cornerRadius.every((n) => typeof n === 'number')) {
    cornerRadius = (r.cornerRadius as number[]).slice(0, 4);
  }
  let children: EngineNode[] = [];
  if (Array.isArray(r.children)) children = r.children.map(parseEngineNode);
  return {
    id: r.id,
    name: str(r.name, 'Layer'),
    type: r.type,
    x: num(r.x, 0),
    y: num(r.y, 0),
    width: num(r.width, 0),
    height: num(r.height, 0),
    rotation: num(r.rotation, 0),
    absoluteBounds: bounds(r.absoluteBounds),
    visible: r.visible !== false,
    locked: r.locked === true,
    opacity: num(r.opacity, 1),
    fills: paints(r.fills),
    strokes: paints(r.strokes),
    strokeWeight: num(r.strokeWeight, 0),
    cornerRadius,
    clip: r.clip === true,
    characters: typeof r.characters === 'string' ? r.characters : null,
    fontFamily: typeof r.fontFamily === 'string' ? r.fontFamily : null,
    fontStyle: typeof r.fontStyle === 'string' ? r.fontStyle : null,
    fontSize: typeof r.fontSize === 'number' ? r.fontSize : null,
    textAlign: typeof r.textAlign === 'string' ? r.textAlign : null,
    lineHeight: typeof r.lineHeight === 'string' ? r.lineHeight : null,
    children,
    childCount: typeof r.childCount === 'number' ? r.childCount : null,
  };
}

export function parseEnginePages(raw: unknown): EnginePage[] {
  if (!Array.isArray(raw)) throw new EngineError('engine returned no page list');
  return raw.map((p): EnginePage => {
    if (typeof p !== 'object' || p === null) throw new EngineError('bad page entry');
    const r = p as Record<string, unknown>;
    if (typeof r.id !== 'number') throw new EngineError('page entry is missing id');
    return {
      id: r.id,
      name: str(r.name, 'Page'),
      current: r.current === true,
      children: num(r.children, 0),
    };
  });
}

function parseIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) throw new EngineError('engine returned no id list');
  return raw.map((n) => {
    if (typeof n !== 'number') throw new EngineError('engine id is not a number');
    return n;
  });
}

export type ShapeKind = 'rectangle' | 'ellipse' | 'line' | 'frame' | 'text';

export class EngineAdapter {
  constructor(private readonly engine: WasmEngineInstance) {}

  /** Raw command escape hatch; parses the result JSON. */
  cmd<T = unknown>(id: string, params: Record<string, unknown> = {}): T {
    let out: string;
    try {
      out = this.engine.execute(id, JSON.stringify(params));
    } catch (e) {
      throw new EngineError(e instanceof Error ? e.message : String(e));
    }
    try {
      return JSON.parse(out) as T;
    } catch {
      throw new EngineError(`engine returned invalid JSON for ${id}`);
    }
  }

  // ---- pages ----

  pages(): EnginePage[] {
    return parseEnginePages(this.cmd('page.list'));
  }

  addPage(name?: string): number {
    const r = this.cmd<{ id: number }>('page.add', name === undefined ? {} : { name });
    if (typeof r.id !== 'number') throw new EngineError('page.add returned no id');
    return r.id;
  }

  selectPage(id: number): void {
    this.cmd('page.select', { id });
  }

  renamePage(id: number, name: string): void {
    this.cmd('page.rename', { id, name });
  }

  deletePage(id: number): void {
    this.cmd('page.delete', { id });
  }

  duplicatePage(id: number): number {
    const r = this.cmd<{ id: number }>('page.duplicate', { id });
    if (typeof r.id !== 'number') throw new EngineError('page.duplicate returned no id');
    return r.id;
  }

  // ---- inspection ----

  describePage(depth = 32): EngineNode {
    try {
      return parseEngineNode(JSON.parse(this.engine.describePage(depth)));
    } catch (e) {
      if (e instanceof EngineError) throw e;
      throw new EngineError(e instanceof Error ? e.message : String(e));
    }
  }

  describeNode(id: number): EngineNode {
    try {
      return parseEngineNode(JSON.parse(this.engine.describeNode(id)));
    } catch (e) {
      if (e instanceof EngineError) throw e;
      throw new EngineError(e instanceof Error ? e.message : String(e));
    }
  }

  // ---- creation ----

  createShape(
    kind: 'rectangle' | 'ellipse' | 'line',
    opts: { x: number; y: number; width: number; height?: number; parent?: number; props?: Record<string, unknown> },
  ): number {
    const params: Record<string, unknown> = { x: opts.x, y: opts.y, width: opts.width };
    if (kind !== 'line' && opts.height !== undefined) params.height = opts.height;
    if (opts.parent !== undefined) params.parent = opts.parent;
    if (opts.props) params.props = opts.props;
    const r = this.cmd<{ id: number }>(`shape.${kind}`, params);
    if (typeof r.id !== 'number') throw new EngineError(`${kind} creation returned no id`);
    return r.id;
  }

  createFrame(opts: { x: number; y: number; width: number; height: number; parent?: number; name?: string }): number {
    const params: Record<string, unknown> = { type: 'frame', ...opts };
    const r = this.cmd<{ id: number }>('node.create', params);
    if (typeof r.id !== 'number') throw new EngineError('frame creation returned no id');
    return r.id;
  }

  createText(opts: { text: string; x: number; y: number; parent?: number; props?: Record<string, unknown> }): number {
    const r = this.cmd<{ id: number }>('text.create', { ...opts });
    if (typeof r.id !== 'number') throw new EngineError('text creation returned no id');
    return r.id;
  }

  // ---- editing ----

  setProps(id: number, props: Record<string, unknown>): void {
    this.cmd('node.set', { id, props });
  }

  setText(id: number, characters: string): void {
    this.cmd('text.set', { id, characters });
  }

  move(ids: number[], dx: number, dy: number): void {
    if (ids.length === 0) return;
    this.cmd('transform.move', { ids, dx, dy });
  }

  resize(ids: number[], width?: number, height?: number, anchor?: string): void {
    if (ids.length === 0) return;
    const params: Record<string, unknown> = { ids };
    if (width !== undefined) params.width = width;
    if (height !== undefined) params.height = height;
    if (anchor !== undefined) params.anchor = anchor;
    this.cmd('transform.resize', params);
  }

  remove(ids: number[]): void {
    if (ids.length === 0) return;
    this.cmd('edit.delete', { ids });
  }

  /** Duplicate via copy+paste; returns the pasted ids. */
  duplicate(ids: number[], parent?: number, x?: number, y?: number): number[] {
    if (ids.length === 0) return [];
    this.cmd('edit.copy', { ids });
    const params: Record<string, unknown> = {};
    if (parent !== undefined) params.parent = parent;
    if (x !== undefined) params.x = x;
    if (y !== undefined) params.y = y;
    const r = this.cmd<{ ids: unknown }>('edit.paste', params);
    return parseIds(r.ids);
  }

  rename(id: number, name: string): void {
    this.cmd('object.rename', { ids: [id], name });
  }

  setVisible(ids: number[], visible: boolean): void {
    if (ids.length === 0) return;
    this.cmd('object.toggleVisible', { ids, visible });
  }

  setLocked(ids: number[], locked: boolean): void {
    if (ids.length === 0) return;
    this.cmd('object.toggleLock', { ids, locked });
  }

  setFill(ids: number[], color: string): void {
    if (ids.length === 0) return;
    this.cmd('fill.set', { ids, color });
  }

  removeFill(ids: number[]): void {
    if (ids.length === 0) return;
    this.cmd('object.removeFill', { ids });
  }

  setStroke(ids: number[], color: string): void {
    if (ids.length === 0) return;
    this.cmd('stroke.set', { ids, color });
  }

  removeStroke(ids: number[]): void {
    if (ids.length === 0) return;
    this.cmd('object.removeStroke', { ids });
  }

  group(ids: number[], name?: string): number {
    const r = this.cmd<{ id: number }>('object.group', name === undefined ? { ids } : { ids, name });
    if (typeof r.id !== 'number') throw new EngineError('group returned no id');
    return r.id;
  }

  ungroup(ids: number[]): void {
    if (ids.length === 0) return;
    this.cmd('object.ungroup', { ids });
  }

  reorder(id: number, index: number): void {
    this.cmd('node.reorder', { id, index });
  }

  reparent(ids: number[], parent: number, index?: number): void {
    if (ids.length === 0) return;
    this.cmd('node.reparent', index === undefined ? { ids, parent } : { ids, parent, index });
  }

  align(ids: number[], which: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'): void {
    if (ids.length === 0) return;
    this.cmd(`align.${which}`, { ids });
  }

  distribute(ids: number[], dir: 'horizontal' | 'vertical'): void {
    if (ids.length === 0) return;
    this.cmd(`distribute.${dir}`, { ids });
  }

  bringForward(ids: number[]): void {
    if (ids.length === 0) return;
    this.cmd('arrange.forward', { ids });
  }

  sendBackward(ids: number[]): void {
    if (ids.length === 0) return;
    this.cmd('arrange.backward', { ids });
  }

  // ---- selection ----

  selection(): number[] {
    try {
      return parseIds(JSON.parse(this.engine.selection()));
    } catch (e) {
      if (e instanceof EngineError) throw e;
      throw new EngineError(e instanceof Error ? e.message : String(e));
    }
  }

  setSelection(ids: number[]): void {
    try {
      this.engine.setSelection(JSON.stringify(ids));
    } catch (e) {
      throw new EngineError(e instanceof Error ? e.message : String(e));
    }
  }

  clearSelection(): void {
    this.cmd('select.none');
  }

  /**
   * The engine's click resolution for a page-space point: one id, or null
   * on empty canvas. Prefer this over `hitTest()[0]` for clicks.
   */
  hitTop(x: number, y: number): number | null {
    try {
      const v = JSON.parse(this.engine.hitTest(x, y)) as { id?: unknown } | null;
      return v !== null && typeof v === 'object' && typeof v.id === 'number' ? v.id : null;
    } catch (e) {
      throw new EngineError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Layers under a page-space point, in engine order: siblings
   * front-to-back, each container ahead of its own descendants.
   */
  hitTest(x: number, y: number): EngineHit[] {
    const r = this.cmd<{ layers: unknown }>('select.layersAt', { x, y });
    if (!Array.isArray(r.layers)) throw new EngineError('hit test returned no layers');
    return r.layers.map((l): EngineHit => {
      if (typeof l !== 'object' || l === null) throw new EngineError('bad hit entry');
      const e = l as Record<string, unknown>;
      if (typeof e.id !== 'number' || typeof e.type !== 'string') {
        throw new EngineError('hit entry is missing id/type');
      }
      return { id: e.id, name: typeof e.name === 'string' ? e.name : 'Layer', type: e.type };
    });
  }

  /** Marquee-select a page-space box; returns the new selection. */
  marquee(x: number, y: number, width: number, height: number, add = false): number[] {
    const r = this.cmd<{ selection: unknown }>('select.area', { x, y, width, height, add });
    return parseIds(r.selection);
  }

  // ---- history / persistence / render ----

  docName(): string {
    try {
      const v = JSON.parse(this.engine.docInfo()) as { name?: unknown };
      return typeof v.name === 'string' ? v.name : 'Untitled';
    } catch {
      return 'Untitled';
    }
  }

  undo(): boolean {
    return this.engine.undo();
  }

  redo(): boolean {
    return this.engine.redo();
  }

  undoDepth(): [number, number] {
    const [u, r] = this.engine.undoDepth().split(',').map(Number);
    return [Number.isFinite(u) ? u : 0, Number.isFinite(r) ? r : 0];
  }

  svg(): string {
    try {
      return this.engine.exportPageSvg();
    } catch (e) {
      throw new EngineError(e instanceof Error ? e.message : String(e));
    }
  }

  save(): string {
    try {
      return this.engine.save();
    } catch (e) {
      throw new EngineError(e instanceof Error ? e.message : String(e));
    }
  }

  load(json: string): void {
    try {
      this.engine.load(json);
    } catch (e) {
      throw new EngineError(e instanceof Error ? e.message : String(e));
    }
  }
}
