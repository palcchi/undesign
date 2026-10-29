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

export interface FramePreset {
  category: string;
  name: string;
  width: number;
  height: number;
}

export interface EngineStyle {
  id: string;
  name: string;
}

export interface EngineComponent {
  id: number;
  name: string;
  type: string;
  page: number;
  instances: number;
}

export interface DocumentColor {
  color: string;
  count: number;
}

export interface PlacedImage {
  id: number;
  image: string;
  width: number;
  height: number;
}

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';
export type LayoutDirection = 'horizontal' | 'vertical' | 'grid';
export type TextToggle = 'bold' | 'italic' | 'underline' | 'strikethrough';
export type TextAlignCmd = 'left' | 'center' | 'right' | 'justify';
export type TextCase = 'original' | 'upper' | 'lower' | 'title' | 'smallCaps';

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
    kind: 'rectangle' | 'ellipse' | 'line' | 'polygon' | 'star' | 'arrow',
    opts: { x: number; y: number; width: number; height?: number; parent?: number; props?: Record<string, unknown> },
  ): number {
    const params: Record<string, unknown> = { x: opts.x, y: opts.y, width: opts.width };
    // Lines and arrows are length-only; every other shape takes a height.
    if (kind !== 'line' && kind !== 'arrow' && opts.height !== undefined) params.height = opts.height;
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

  // ---- frames ----

  /** Wrap layers in a frame; returns the frame id. */
  frameSelection(ids: number[], name?: string): number {
    const r = this.cmd<{ id: number }>('object.frameSelection', name === undefined ? { ids } : { ids, name });
    if (typeof r.id !== 'number') throw new EngineError('frame selection returned no id');
    return r.id;
  }

  removeFrame(ids: number[]): void {
    if (ids.length === 0) return;
    this.cmd('object.removeFrame', { ids });
  }

  swapOrientation(ids: number[]): void {
    if (ids.length === 0) return;
    this.cmd('frame.swapOrientation', { ids });
  }

  framePresets(): FramePreset[] {
    const r = this.cmd<unknown>('frame.presets');
    if (!Array.isArray(r)) throw new EngineError('frame presets returned no list');
    return r.map((p): FramePreset => {
      if (typeof p !== 'object' || p === null) throw new EngineError('bad frame preset');
      const e = p as Record<string, unknown>;
      return { category: str(e.category, ''), name: str(e.name, ''), width: num(e.width, 0), height: num(e.height, 0) };
    });
  }

  // ---- masks ----

  /**
   * Use as mask: a single layer toggles its mask flag (returns null); several
   * layers are grouped with the bottom-most child as the mask (returns the
   * group id).
   */
  mask(ids: number[]): number | null {
    if (ids.length === 0) return null;
    const r = this.cmd<{ id?: unknown }>('object.mask', { ids });
    return typeof r.id === 'number' ? r.id : null;
  }

  releaseMask(ids: number[]): void {
    if (ids.length === 0) return;
    this.cmd('object.releaseMask', { ids });
  }

  // ---- booleans ----

  booleanCombine(ids: number[], op: BooleanOp): void {
    if (ids.length === 0) return;
    this.cmd(`bool.${op}`, { ids });
  }

  flattenBoolean(ids: number[]): void {
    if (ids.length === 0) return;
    this.cmd('bool.flatten', { ids });
  }

  // ---- rasterize / move to page ----

  rasterize(ids: number[], scale = 2): void {
    if (ids.length === 0) return;
    this.cmd('object.rasterize', { ids, scale });
  }

  moveToPage(ids: number[], page: number): void {
    if (ids.length === 0) return;
    this.cmd('object.moveToPage', { ids, page });
  }

  // ---- auto-layout ----

  layoutAdd(ids: number[], direction?: LayoutDirection): void {
    if (ids.length === 0) return;
    this.cmd('layout.add', direction === undefined ? { ids } : { ids, direction });
  }

  layoutRemove(ids: number[]): void {
    if (ids.length === 0) return;
    this.cmd('layout.remove', { ids });
  }

  // ---- shared styles ----

  listStyles(type?: string): EngineStyle[] {
    const r = this.cmd<unknown>('style.list', type === undefined ? {} : { type });
    if (!Array.isArray(r)) throw new EngineError('style list returned no list');
    return r.map((s): EngineStyle => {
      if (typeof s !== 'object' || s === null) throw new EngineError('bad style entry');
      const e = s as Record<string, unknown>;
      if (typeof e.id !== 'string') throw new EngineError('style entry is missing id');
      return { id: e.id, name: str(e.name, '') };
    });
  }

  createStyle(opts: {
    type: 'paint' | 'text' | 'effect' | 'grid';
    name: string;
    from?: number;
    description?: string;
    value?: unknown;
  }): string {
    const params: Record<string, unknown> = { type: opts.type, name: opts.name };
    if (opts.from !== undefined) params.from = opts.from;
    if (opts.description !== undefined) params.description = opts.description;
    if (opts.value !== undefined) params.value = opts.value;
    const r = this.cmd<{ id: unknown }>('style.create', params);
    if (typeof r.id !== 'string') throw new EngineError('style creation returned no id');
    return r.id;
  }

  applyStyle(opts: { ids?: number[]; style: string; target?: 'fill' | 'stroke'; start?: number; end?: number }): void {
    const params: Record<string, unknown> = { style: opts.style };
    if (opts.ids !== undefined) params.ids = opts.ids;
    if (opts.target !== undefined) params.target = opts.target;
    if (opts.start !== undefined) params.start = opts.start;
    if (opts.end !== undefined) params.end = opts.end;
    this.cmd('style.apply', params);
  }

  detachStyle(opts: { ids?: number[]; which: 'fill' | 'stroke' | 'effect' | 'grid' | 'text'; start?: number; end?: number }): void {
    const params: Record<string, unknown> = { which: opts.which };
    if (opts.ids !== undefined) params.ids = opts.ids;
    if (opts.start !== undefined) params.start = opts.start;
    if (opts.end !== undefined) params.end = opts.end;
    this.cmd('style.detach', params);
  }

  deleteStyle(style: string): void {
    this.cmd('style.delete', { style });
  }

  /** Solid colors used on a page, most-used first. */
  documentColors(page?: number, limit?: number): DocumentColor[] {
    const params: Record<string, unknown> = {};
    if (page !== undefined) params.page = page;
    if (limit !== undefined) params.limit = limit;
    const r = this.cmd<{ colors: unknown }>('paint.documentColors', params);
    if (!Array.isArray(r.colors)) throw new EngineError('document colors returned no list');
    return r.colors.map((c): DocumentColor => {
      if (typeof c !== 'object' || c === null) throw new EngineError('bad color entry');
      const e = c as Record<string, unknown>;
      return { color: str(e.color, ''), count: num(e.count, 0) };
    });
  }

  // ---- components ----

  listComponents(): EngineComponent[] {
    const r = this.cmd<unknown>('component.list');
    if (!Array.isArray(r)) throw new EngineError('component list returned no list');
    return r.map((c): EngineComponent => {
      if (typeof c !== 'object' || c === null) throw new EngineError('bad component entry');
      const e = c as Record<string, unknown>;
      if (typeof e.id !== 'number') throw new EngineError('component entry is missing id');
      return {
        id: e.id,
        name: str(e.name, ''),
        type: str(e.type, ''),
        page: num(e.page, 0),
        instances: num(e.instances, 0),
      };
    });
  }

  /** One frame/group becomes a component; several layers are wrapped in one. */
  createComponent(ids?: number[]): number {
    const r = this.cmd<{ id: number }>('component.create', ids === undefined ? {} : { ids });
    if (typeof r.id !== 'number') throw new EngineError('component creation returned no id');
    return r.id;
  }

  createInstance(opts: { component: number; x?: number; y?: number; parent?: number }): number {
    const params: Record<string, unknown> = { component: opts.component };
    if (opts.x !== undefined) params.x = opts.x;
    if (opts.y !== undefined) params.y = opts.y;
    if (opts.parent !== undefined) params.parent = opts.parent;
    const r = this.cmd<{ id: number }>('instance.create', params);
    if (typeof r.id !== 'number') throw new EngineError('instance creation returned no id');
    return r.id;
  }

  swapInstance(ids: number[], component: number): void {
    if (ids.length === 0) return;
    this.cmd('instance.swap', { ids, component });
  }

  detachInstance(ids: number[]): void {
    if (ids.length === 0) return;
    this.cmd('component.detach', { ids });
  }

  resetInstance(ids: number[]): void {
    if (ids.length === 0) return;
    this.cmd('component.resetInstance', { ids });
  }

  // ---- prototype flows ----

  flowAdd(opts: { start?: number; name?: string }): void {
    const params: Record<string, unknown> = {};
    if (opts.start !== undefined) params.start = opts.start;
    if (opts.name !== undefined) params.name = opts.name;
    this.cmd('proto.flow.add', params);
  }

  flowRename(opts: { start: number; name?: string; description?: string }): void {
    const params: Record<string, unknown> = { start: opts.start };
    if (opts.name !== undefined) params.name = opts.name;
    if (opts.description !== undefined) params.description = opts.description;
    this.cmd('proto.flow.rename', params);
  }

  flowRemove(opts: { start: number }): void {
    this.cmd('proto.flow.remove', { start: opts.start });
  }

  clearInteractions(ids?: number[]): void {
    this.cmd('proto.interaction.clear', ids === undefined ? {} : { ids });
  }

  removeInteraction(opts: { id?: number; index: number }): void {
    const params: Record<string, unknown> = { index: opts.index };
    if (opts.id !== undefined) params.id = opts.id;
    this.cmd('proto.interaction.remove', params);
  }

  // ---- text styling ----

  textToggle(ids: number[], which: TextToggle): void {
    if (ids.length === 0) return;
    this.cmd(`text.${which}`, { ids });
  }

  textAlignCmd(ids: number[], which: TextAlignCmd): void {
    if (ids.length === 0) return;
    const cmd = which === 'left' ? 'text.alignLeft' : which === 'center' ? 'text.alignCenter' : which === 'right' ? 'text.alignRight' : 'text.alignJustify';
    this.cmd(cmd, { ids });
  }

  textSizeStep(ids: number[], dir: 'up' | 'down'): void {
    if (ids.length === 0) return;
    this.cmd(dir === 'up' ? 'text.sizeUp' : 'text.sizeDown', { ids });
  }

  textCase(ids: number[], which: TextCase): void {
    if (ids.length === 0) return;
    this.cmd('text.case', { ids, case: which });
  }

  // ---- images ----

  /**
   * Place an image from base64 bytes (a data-URL prefix is tolerated) and
   * return the placed node. Large images are fit into 1000px by the engine.
   */
  placeImage(opts: { data?: string; path?: string; x?: number; y?: number; parent?: number; mode?: 'fill' | 'fit' | 'crop' | 'tile'; width?: number; height?: number; name?: string }): PlacedImage {
    const params: Record<string, unknown> = {};
    if (opts.data !== undefined) params.data = opts.data;
    if (opts.path !== undefined) params.path = opts.path;
    if (opts.x !== undefined) params.x = opts.x;
    if (opts.y !== undefined) params.y = opts.y;
    if (opts.parent !== undefined) params.parent = opts.parent;
    if (opts.mode !== undefined) params.mode = opts.mode;
    if (opts.width !== undefined) params.width = opts.width;
    if (opts.height !== undefined) params.height = opts.height;
    if (opts.name !== undefined) params.name = opts.name;
    const r = this.cmd<{ id: unknown; image: unknown; width: unknown; height: unknown }>('file.placeImage', params);
    if (typeof r.id !== 'number') throw new EngineError('image placement returned no id');
    return { id: r.id, image: str(r.image, ''), width: num(r.width, 0), height: num(r.height, 0) };
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
