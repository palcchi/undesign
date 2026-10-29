import type { DesignObject, DocPage, UndesignDoc } from './types';

export const STORAGE_KEY = 'undesign.doc.v1';

const TYPES = new Set(['frame', 'rectangle', 'ellipse', 'text', 'line']);

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

function sanitizeObject(raw: unknown): DesignObject | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || !TYPES.has(raw.type as string)) return null;
  const align = raw.textAlign === 'center' || raw.textAlign === 'right' ? raw.textAlign : 'left';
  return {
    id: raw.id,
    type: raw.type as DesignObject['type'],
    name: str(raw.name, 'Layer'),
    parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    w: Math.max(1, num(raw.w, 100)),
    h: Math.max(1, num(raw.h, 100)),
    rotation: num(raw.rotation, 0),
    visible: bool(raw.visible, true),
    locked: bool(raw.locked, false),
    opacity: Math.min(1, Math.max(0, num(raw.opacity, 1))),
    fill: str(raw.fill, ''),
    fillOpacity: Math.min(1, Math.max(0, num(raw.fillOpacity, 1))),
    stroke: str(raw.stroke, ''),
    strokeWidth: Math.max(0, num(raw.strokeWidth, 0)),
    cornerRadius: Math.max(0, num(raw.cornerRadius, 0)),
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
    return {
      version: 1,
      name: str(data.name, 'Untitled'),
      pages,
      activePageId,
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
