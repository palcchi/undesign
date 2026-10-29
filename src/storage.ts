import type { ColorStyle, ComponentDef, Constraints, CornerRadii, DesignObject, DocPage, FillGradient, PrototypeLink, UndesignDoc } from './types';
import { pruneLinks } from './prototype';

export const STORAGE_KEY = 'undesign.doc.v1';

const TYPES = new Set(['frame', 'rectangle', 'ellipse', 'text', 'line', 'image']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeGradient(value: unknown): FillGradient | null {
  if (!isObject(value)) return null;
  if (!Array.isArray(value.stops)) return null;
  const stops = value.stops
    .filter(isObject)
    .map((s) => ({
      offset: Math.min(1, Math.max(0, num(s.offset, 0))),
      color: str(s.color, ''),
    }))
    .filter((s) => s.color !== '')
    .slice(0, 8)
    .sort((a, b) => a.offset - b.offset);
  if (stops.length < 2) return null;
  return { angle: num(value.angle, 90), stops };
}

function sanitizeRadii(value: unknown): CornerRadii | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return null;
  return [value[0], value[1], value[2], value[3]];
}

function sanitizeSnapshot(value: unknown): Record<string, DesignObject> | null {
  if (!isObject(value)) return null;
  const out: Record<string, DesignObject> = {};
  for (const [k, v] of Object.entries(value)) {
    const clean = sanitizeObject(v);
    if (clean) out[k] = clean;
  }
  return out;
}

function sanitizeComponent(raw: unknown): ComponentDef | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.pageId !== 'string' || typeof raw.rootId !== 'string') return null;
  return { id: raw.id, name: str(raw.name, 'Component'), pageId: raw.pageId, rootId: raw.rootId };
}

const H_VALUES = new Set(['left', 'center', 'right', 'stretch', 'scale']);
const V_VALUES = new Set(['top', 'middle', 'bottom', 'stretch', 'scale']);

function sanitizeConstraints(value: unknown): Constraints | null {
  if (!isObject(value)) return null;
  if (!H_VALUES.has(value.horizontal as string) || !V_VALUES.has(value.vertical as string)) return null;
  return {
    horizontal: value.horizontal as Constraints['horizontal'],
    vertical: value.vertical as Constraints['vertical'],
  };
}

function sanitizeColorStyle(raw: unknown): ColorStyle | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.color !== 'string' || raw.color === '') return null;
  return { id: raw.id, name: str(raw.name, 'Style'), color: raw.color };
}

function sanitizeLink(raw: unknown): PrototypeLink | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.sourceId !== 'string' || typeof raw.targetFrameId !== 'string') return null;
  return { id: raw.id, sourceId: raw.sourceId, targetFrameId: raw.targetFrameId };
}

function sanitizeObject(raw: unknown): DesignObject | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || !TYPES.has(raw.type as string)) return null;
  const align = raw.textAlign === 'center' || raw.textAlign === 'right' ? raw.textAlign : 'left';
  // Lines legitimately carry zero/negative dims (horizontal, vertical,
  // upward diagonals, collapsed points); every other type needs >= 1.
  const isLine = raw.type === 'line';
  return {
    id: raw.id,
    type: raw.type as DesignObject['type'],
    name: str(raw.name, 'Layer'),
    parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    w: isLine ? Math.max(0, num(raw.w, 100)) : Math.max(1, num(raw.w, 100)),
    h: isLine ? num(raw.h, 0) : Math.max(1, num(raw.h, 100)),
    rotation: num(raw.rotation, 0),
    visible: bool(raw.visible, true),
    locked: bool(raw.locked, false),
    opacity: Math.min(1, Math.max(0, num(raw.opacity, 1))),
    fill: str(raw.fill, ''),
    fillOpacity: Math.min(1, Math.max(0, num(raw.fillOpacity, 1))),
    fillGradient: sanitizeGradient(raw.fillGradient),
    fillStyleId: typeof raw.fillStyleId === 'string' && raw.fillStyleId !== '' ? raw.fillStyleId : null,
    constraints: sanitizeConstraints(raw.constraints),
    stroke: str(raw.stroke, ''),
    strokeWidth: Math.max(0, num(raw.strokeWidth, 0)),
    cornerRadius: Math.max(0, num(raw.cornerRadius, 0)),
    cornerRadii: sanitizeRadii(raw.cornerRadii),
    componentId: typeof raw.componentId === 'string' && raw.componentId !== '' ? raw.componentId : null,
    sourceId: typeof raw.sourceId === 'string' && raw.sourceId !== '' ? raw.sourceId : null,
    componentSnapshot: sanitizeSnapshot(raw.componentSnapshot),
    imageId: typeof raw.imageId === 'string' && raw.imageId !== '' ? raw.imageId : null,
    imageName: str(raw.imageName, ''),
    naturalW: Math.max(0, num(raw.naturalW, 0)),
    naturalH: Math.max(0, num(raw.naturalH, 0)),
    clip: bool(raw.clip, false),
    text: str(raw.text, ''),
    fontFamily: str(raw.fontFamily, 'Inter, system-ui, sans-serif'),
    fontSize: Math.max(1, num(raw.fontSize, 16)),
    fontWeight: num(raw.fontWeight, 400),
    textAlign: align,
    lineHeight: num(raw.lineHeight, 1.4),
  };
}

function sanitizePage(raw: unknown): DocPage | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || !Array.isArray(raw.objects)) return null;
  const objects: DesignObject[] = [];
  for (const o of raw.objects) {
    const clean = sanitizeObject(o);
    if (clean) objects.push(clean);
  }
  // Drop dangling parent references.
  const ids = new Set(objects.map((o) => o.id));
  for (const o of objects) {
    if (o.parentId && !ids.has(o.parentId)) o.parentId = null;
  }
  // Break self-parent and cyclic references (objects are kept; only the bad
  // links are detached to the page root so traversal can never loop).
  const byId = new Map(objects.map((o) => [o.id, o]));
  for (const o of objects) {
    const path = new Set<string>([o.id]);
    let p = o.parentId ? byId.get(o.parentId) : undefined;
    while (p && !path.has(p.id)) {
      path.add(p.id);
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    if (p) o.parentId = null;
  }
  return { id: raw.id, name: str(raw.name, 'Page'), objects };
}

/** Validate unknown input as a document; returns null when unusable. */
export function validateDoc(data: unknown): UndesignDoc | null {
  try {
    if (!isObject(data)) return null;
    if (!Array.isArray(data.pages) || data.pages.length === 0) return null;
    const pages: DocPage[] = [];
    for (const p of data.pages) {
      const clean = sanitizePage(p);
      if (clean) pages.push(clean);
    }
    if (pages.length === 0) return null;
    const activePageId =
      typeof data.activePageId === 'string' &&
      pages.some((p) => p.id === data.activePageId)
        ? (data.activePageId as string)
        : pages[0].id;
    const components: ComponentDef[] = [];
    if (Array.isArray(data.components)) {
      for (const c of data.components) {
        const clean = sanitizeComponent(c);
        if (clean) components.push(clean);
      }
    }
    const colorStyles: ColorStyle[] = [];
    if (Array.isArray(data.colorStyles)) {
      for (const s of data.colorStyles) {
        const clean = sanitizeColorStyle(s);
        if (clean) colorStyles.push(clean);
      }
    }
    // Dangling style references (e.g. hand-edited JSON) detach to plain fills.
    const styleIds = new Set(colorStyles.map((s) => s.id));
    for (const p of pages) {
      for (const o of p.objects) {
        if (o.fillStyleId !== null && !styleIds.has(o.fillStyleId)) o.fillStyleId = null;
      }
    }
    const rawLinks: PrototypeLink[] = [];
    if (Array.isArray(data.prototypeLinks)) {
      for (const l of data.prototypeLinks) {
        const clean = sanitizeLink(l);
        if (clean) rawLinks.push(clean);
      }
    }
    return {
      version: 1,
      name: str(data.name, 'Untitled'),
      pages,
      activePageId,
      components,
      colorStyles,
      prototypeLinks: pruneLinks(pages, rawLinks),
    };
  } catch {
    return null;
  }
}

export function loadStoredDoc(): UndesignDoc | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return validateDoc(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function saveStoredDoc(doc: UndesignDoc): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // Storage full or unavailable — the app keeps working in memory.
  }
}
