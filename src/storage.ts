import type { ChildSizing, ColorStyle, ComponentDef, Constraints, CornerRadii, DesignObject, DocPage, DropShadow, EffectStyle, FillGradient, FrameLayout, InstanceVariant, NestedExpose, PrototypeLink, PropDef, TextStyle, UndesignDoc, VariantSet } from './types';
import { pruneLinks } from './prototype';
import { breakComponentCycles } from './library';

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
  const exposed: Record<string, NestedExpose> = {};
  if (isObject(raw.exposed)) {
    for (const [k, v] of Object.entries(raw.exposed)) {
      if (isObject(v) && typeof v.instance === 'string' && v.instance !== '' && typeof v.prop === 'string' && v.prop !== '') {
        exposed[k] = { instance: v.instance, prop: v.prop };
      }
    }
  }
  return { id: raw.id, name: str(raw.name, 'Component'), pageId: raw.pageId, rootId: raw.rootId, exposed };
}

function sanitizePropDef(raw: unknown): PropDef | null {
  if (!isObject(raw)) return null;
  if (typeof raw.name !== 'string' || raw.name === '') return null;
  if (raw.kind === 'boolean') {
    return { name: raw.name, kind: 'boolean', default: typeof raw.default === 'boolean' ? raw.default : true };
  }
  if (raw.kind === 'text') {
    return { name: raw.name, kind: 'text', default: typeof raw.default === 'string' ? raw.default : '' };
  }
  return null;
}

function sanitizeVariantSet(raw: unknown, knownDefs: Set<string>): VariantSet | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  const properties: PropDef[] = [];
  if (Array.isArray(raw.properties)) {
    const names = new Set<string>();
    for (const p of raw.properties) {
      const clean = sanitizePropDef(p);
      if (clean && !names.has(clean.name)) {
        names.add(clean.name);
        properties.push(clean);
      }
    }
  }
  const propNames = new Set(properties.map((p) => p.name));
  const variants = Array.isArray(raw.variants)
    ? raw.variants.filter((v): v is string => typeof v === 'string' && knownDefs.has(v))
    : [];
  if (variants.length === 0) return null;
  const bindings: Record<string, string> = {};
  if (isObject(raw.bindings)) {
    for (const [k, v] of Object.entries(raw.bindings)) {
      if (propNames.has(k) && typeof v === 'string' && v !== '') bindings[k] = v;
    }
  }
  return { id: raw.id, name: str(raw.name, 'Variant set'), properties, variants, bindings };
}

function sanitizeValuesRecord(raw: unknown): Record<string, boolean | string> | null {
  if (!isObject(raw)) return null;
  const out: Record<string, boolean | string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'boolean' || typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeInstanceVariant(raw: unknown): InstanceVariant | null {
  if (!isObject(raw)) return null;
  if (typeof raw.setId !== 'string' || raw.setId === '') return null;
  const values: Record<string, boolean | string> = {};
  if (isObject(raw.values)) {
    for (const [k, v] of Object.entries(raw.values)) {
      if (typeof v === 'boolean' || typeof v === 'string') values[k] = v;
    }
  }
  return { setId: raw.setId, values };
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

const LAYOUT_DIRECTIONS = new Set(['horizontal', 'vertical']);
const ALIGN_MAIN = new Set(['start', 'center', 'end', 'space-between']);
const ALIGN_CROSS = new Set(['start', 'center', 'end']);
const SIZING_MODES = new Set(['fixed', 'hug', 'fill']);

function sanitizeFrameLayout(value: unknown): FrameLayout | null {
  if (!isObject(value)) return null;
  if (!LAYOUT_DIRECTIONS.has(value.direction as string)) return null;
  if (!ALIGN_MAIN.has(value.alignMain as string) || !ALIGN_CROSS.has(value.alignCross as string)) return null;
  return {
    direction: value.direction as FrameLayout['direction'],
    gap: Math.max(0, num(value.gap, 0)),
    paddingTop: Math.max(0, num(value.paddingTop, 0)),
    paddingRight: Math.max(0, num(value.paddingRight, 0)),
    paddingBottom: Math.max(0, num(value.paddingBottom, 0)),
    paddingLeft: Math.max(0, num(value.paddingLeft, 0)),
    alignMain: value.alignMain as FrameLayout['alignMain'],
    alignCross: value.alignCross as FrameLayout['alignCross'],
  };
}

function optNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function sanitizeChildSizing(value: unknown): ChildSizing | null {
  if (!isObject(value)) return null;
  if (!SIZING_MODES.has(value.h as string) || !SIZING_MODES.has(value.v as string)) return null;
  return {
    h: value.h as ChildSizing['h'],
    v: value.v as ChildSizing['v'],
    minW: optNum(value.minW),
    maxW: optNum(value.maxW),
    minH: optNum(value.minH),
    maxH: optNum(value.maxH),
    absolute: bool(value.absolute, false),
  };
}

function sanitizeColorStyle(raw: unknown): ColorStyle | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.color !== 'string' || raw.color === '') return null;
  return { id: raw.id, name: str(raw.name, 'Style'), color: raw.color };
}

function sanitizeTextStyle(raw: unknown): TextStyle | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  const align = raw.textAlign === 'center' || raw.textAlign === 'right' ? raw.textAlign : 'left';
  return {
    id: raw.id,
    name: str(raw.name, 'Style'),
    fontFamily: str(raw.fontFamily, 'Inter, system-ui, sans-serif'),
    fontSize: Math.max(1, num(raw.fontSize, 16)),
    fontWeight: num(raw.fontWeight, 400),
    textAlign: align,
    lineHeight: num(raw.lineHeight, 1.4),
  };
}

function sanitizeDropShadow(raw: unknown): DropShadow | null {
  if (!isObject(raw)) return null;
  if (typeof raw.color !== 'string' || raw.color === '') return null;
  return {
    offsetX: num(raw.offsetX, 0),
    offsetY: num(raw.offsetY, 0),
    blur: Math.max(0, num(raw.blur, 0)),
    // Legacy documents predate spread; missing/hostile values hug at 0.
    spread: Math.max(0, num(raw.spread, 0)),
    color: raw.color,
    opacity: Math.min(1, Math.max(0, num(raw.opacity, 1))),
  };
}

function sanitizeEffectStyle(raw: unknown): EffectStyle | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  const shadow = sanitizeDropShadow(raw.shadow);
  if (!shadow) return null;
  return { id: raw.id, name: str(raw.name, 'Style'), shadow };
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
    textStyleId: typeof raw.textStyleId === 'string' && raw.textStyleId !== '' ? raw.textStyleId : null,
    shadow: sanitizeDropShadow(raw.shadow),
    effectStyleId: typeof raw.effectStyleId === 'string' && raw.effectStyleId !== '' ? raw.effectStyleId : null,
    constraints: sanitizeConstraints(raw.constraints),
    layout: sanitizeFrameLayout(raw.layout),
    sizing: sanitizeChildSizing(raw.sizing),
    stroke: str(raw.stroke, ''),
    strokeWidth: Math.max(0, num(raw.strokeWidth, 0)),
    cornerRadius: Math.max(0, num(raw.cornerRadius, 0)),
    cornerRadii: sanitizeRadii(raw.cornerRadii),
    componentId: typeof raw.componentId === 'string' && raw.componentId !== '' ? raw.componentId : null,
    sourceId: typeof raw.sourceId === 'string' && raw.sourceId !== '' ? raw.sourceId : null,
    componentSnapshot: sanitizeSnapshot(raw.componentSnapshot),
    variant: sanitizeInstanceVariant(raw.variant),
    exposedValues: sanitizeValuesRecord(raw.exposedValues),
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
    const knownDefs = new Set(components.map((c) => c.id));
    const variantSets: VariantSet[] = [];
    if (Array.isArray(data.variantSets)) {
      for (const s of data.variantSets) {
        const clean = sanitizeVariantSet(s, knownDefs);
        if (clean) variantSets.push(clean);
      }
    }
    // Break def reference cycles before membership checks (load-time repair).
    const debroken = breakComponentCycles({
      version: 1,
      name: typeof data.name === 'string' ? data.name : 'Untitled',
      pages,
      activePageId,
      components,
      variantSets,
      colorStyles: [],
      textStyles: [],
      effectStyles: [],
      prototypeLinks: [],
    });
    for (let i = 0; i < pages.length; i++) {
      if (debroken.pages[i] !== pages[i]) pages[i] = debroken.pages[i];
    }
    const colorStyles: ColorStyle[] = [];
    if (Array.isArray(data.colorStyles)) {
      for (const s of data.colorStyles) {
        const clean = sanitizeColorStyle(s);
        if (clean) colorStyles.push(clean);
      }
    }
    const textStyles: TextStyle[] = [];
    if (Array.isArray(data.textStyles)) {
      for (const s of data.textStyles) {
        const clean = sanitizeTextStyle(s);
        if (clean) textStyles.push(clean);
      }
    }
    const effectStyles: EffectStyle[] = [];
    if (Array.isArray(data.effectStyles)) {
      for (const s of data.effectStyles) {
        const clean = sanitizeEffectStyle(s);
        if (clean) effectStyles.push(clean);
      }
    }
    // Dangling style references (e.g. hand-edited JSON) detach to plain values.
    const styleIds = new Set(colorStyles.map((s) => s.id));
    const textStyleIds = new Set(textStyles.map((s) => s.id));
    const effectStyleIds = new Set(effectStyles.map((s) => s.id));
    const setById = new Map(variantSets.map((s) => [s.id, s]));
    const defById = new Map(components.map((c) => [c.id, c]));
    for (const p of pages) {
      for (const o of p.objects) {
        if (o.fillStyleId !== null && !styleIds.has(o.fillStyleId)) o.fillStyleId = null;
        if (o.textStyleId !== null && !textStyleIds.has(o.textStyleId)) o.textStyleId = null;
        if (o.effectStyleId !== null && !effectStyleIds.has(o.effectStyleId)) o.effectStyleId = null;
        // Variant membership must name a live set containing the instance's
        // def; anything else degrades to a plain instance of the same def.
        if (o.variant !== null) {
          const s = setById.get(o.variant.setId);
          const propNames = s ? new Set(s.properties.map((pr) => pr.name)) : new Set<string>();
          if (o.componentId === null || !s || !s.variants.includes(o.componentId)) {
            o.variant = null;
          } else {
            const values: Record<string, boolean | string> = {};
            for (const [k, v] of Object.entries(o.variant.values)) {
              if (propNames.has(k)) values[k] = v;
            }
            o.variant = { setId: s.id, values };
          }
        }
        // Exposed values keep only aliases the instance's def actually exposes.
        if (o.exposedValues !== null) {
          const def = o.componentId ? defById.get(o.componentId) : undefined;
          const aliases = def ? new Set(Object.keys(def.exposed ?? {})) : new Set<string>();
          const kept: Record<string, boolean | string> = {};
          for (const [k, v] of Object.entries(o.exposedValues)) {
            if (aliases.has(k)) kept[k] = v;
          }
          o.exposedValues = Object.keys(kept).length > 0 ? kept : null;
        }
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
      variantSets,
      colorStyles,
      textStyles,
      effectStyles,
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
