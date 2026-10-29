/**
 * FC→UND readback: rebuilds an Undesign document from engine snapshots
 * (`page.list` + `describePage`). Covers the same representable subset the
 * converter writes, so UND→FC→UND round-trips preserve it; everything else
 * produces an explicit warning. Used by migration verification and by the
 * round-trip tests over real captured engine output.
 */
import type { DesignObject, DocPage, ObjectType, TextAlign, UndesignDoc } from '../types';
import type { EngineNode, EnginePage } from './adapter';

export interface ReadbackWarning {
  scope: string;
  property: string;
  detail: string;
}

export interface ReadbackResult {
  doc: UndesignDoc;
  warnings: ReadbackWarning[];
}

function blankObject(id: string, type: ObjectType): DesignObject {
  return {
    id,
    type,
    name: 'Layer',
    parentId: null,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    rotation: 0,
    visible: true,
    locked: false,
    opacity: 1,
    fill: '',
    fillOpacity: 1,
    fillGradient: null,
    fillStyleId: null,
    textStyleId: null,
    shadow: null,
    effectStyleId: null,
    constraints: null,
    layout: null,
    sizing: null,
    stroke: '',
    strokeWidth: 0,
    cornerRadius: 0,
    cornerRadii: null,
    clip: false,
    componentId: null,
    sourceId: null,
    componentSnapshot: null,
    variant: null,
    exposedValues: null,
    imageId: null,
    imageName: '',
    naturalW: 0,
    naturalH: 0,
    text: '',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 16,
    fontWeight: 400,
    textAlign: 'left',
    lineHeight: 1.4,
  };
}

function mapFill(o: DesignObject, n: EngineNode, warn: (w: ReadbackWarning) => void): void {
  if (n.fills.length === 0) {
    o.fill = '';
    return;
  }
  const [first, ...rest] = n.fills;
  if (rest.length > 0) {
    warn({ scope: String(n.id), property: 'fills', detail: `${rest.length} extra fill(s) dropped; first kept` });
  }
  if (first.type !== 'solid' || typeof first.color !== 'string') {
    warn({ scope: String(n.id), property: 'fills', detail: `non-solid fill (${first.type}) dropped` });
    o.fill = '';
    return;
  }
  o.fill = first.color;
  o.fillOpacity = first.opacity ?? 1;
}

function mapStroke(o: DesignObject, n: EngineNode): void {
  if (n.strokes.length === 0) {
    o.stroke = '';
    o.strokeWidth = 0;
    return;
  }
  const first = n.strokes[0];
  o.stroke = first.type === 'solid' && typeof first.color === 'string' ? first.color : '';
  o.strokeWidth = n.strokeWeight;
}

function mapCorners(o: DesignObject, n: EngineNode): void {
  if (n.cornerRadius === null || n.cornerRadius === undefined) return;
  if (typeof n.cornerRadius === 'number') {
    o.cornerRadius = n.cornerRadius;
    return;
  }
  const [a = 0, b = 0, c = 0, d = 0] = n.cornerRadius;
  o.cornerRadius = 0;
  o.cornerRadii = [a, b, c, d];
}

function mapAlign(v: string | null, id: number, warn: (w: ReadbackWarning) => void): TextAlign {
  if (v === 'center' || v === 'right') return v;
  if (v === 'left' || v === null || v === undefined) return 'left';
  warn({ scope: String(id), property: 'textAlign', detail: `alignment "${v}" approximated as left` });
  return 'left';
}

function mapLineHeight(v: string | null, fontSize: number, id: number, warn: (w: ReadbackWarning) => void): number {
  if (v === null || v === undefined || v === 'Auto') return 1.4;
  if (v.endsWith('%')) {
    const n = Number(v.slice(0, -1));
    if (Number.isFinite(n)) return n / 100;
  } else {
    const px = Number(v);
    if (Number.isFinite(px) && fontSize > 0) return px / fontSize;
  }
  warn({ scope: String(id), property: 'lineHeight', detail: `leading "${v}" approximated as 1.4` });
  return 1.4;
}

function walk(
  n: EngineNode,
  parentUndId: string | null,
  out: DesignObject[],
  warn: (w: ReadbackWarning) => void,
): void {
  const undId = `m${n.id}`;
  const typeMap: Record<string, ObjectType | null> = {
    FRAME: 'frame',
    GROUP: 'frame', // UND groups are frames; structural equivalent, nothing lost.
    RECTANGLE: 'rectangle',
    ELLIPSE: 'ellipse',
    TEXT: 'text',
    LINE: 'line',
  };
  const type = typeMap[n.type] ?? null;
  if (type === null) {
    warn({ scope: String(n.id), property: 'type', detail: `engine type ${n.type} has no UND mapping; subtree skipped` });
    return;
  }
  const o = blankObject(undId, type);
  o.name = n.name;
  o.parentId = parentUndId;
  // Engine rotation is counter-clockwise-positive; UND is clockwise-positive.
  o.rotation = -n.rotation;
  o.visible = n.visible;
  o.locked = n.locked;
  o.opacity = n.opacity;
  if (type === 'line') {
    // Direction is ambiguous from bounds alone; keep the bbox and say so.
    const b = n.absoluteBounds;
    if (b) {
      o.x = b.x;
      o.y = b.y;
      o.w = b.width;
      o.h = b.height;
    }
    o.rotation = 0;
    warn({ scope: String(n.id), property: 'geometry', detail: 'line direction approximated from bounds' });
  } else {
    o.x = n.x;
    o.y = n.y;
    o.w = n.width;
    o.h = n.height;
  }
  mapFill(o, n, warn);
  mapStroke(o, n);
  mapCorners(o, n);
  if (type === 'frame') o.clip = n.clip;
  if (type === 'text') {
    o.text = n.characters ?? '';
    o.fontFamily = n.fontFamily ?? o.fontFamily;
    o.fontSize = n.fontSize ?? o.fontSize;
    o.fontWeight = mapFontWeight(n.fontStyle, n.id, warn);
    o.textAlign = mapAlign(n.textAlign, n.id, warn);
    o.lineHeight = mapLineHeight(n.lineHeight, o.fontSize, n.id, warn);
  }
  out.push(o);
  for (const c of n.children) walk(c, undId, out, warn);
  if (n.children.length === 0 && n.childCount !== null && n.childCount > 0) {
    warn({ scope: String(n.id), property: 'children', detail: `${n.childCount} child(ren) below describe depth; re-read deeper` });
  }
}

function mapFontWeight(v: string | null, id: number, warn: (w: ReadbackWarning) => void): number {
  if (v === null || v === undefined || v === '' || v === 'Regular') return 400;
  const lower = v.toLowerCase();
  if (lower.includes('bold')) return lower.includes('extra') || lower.includes('ultra') ? 800 : 700;
  if (lower.includes('semibold') || lower.includes('demibold')) return 600;
  if (lower.includes('medium')) return 500;
  if (lower.includes('light') || lower.includes('thin')) return 300;
  warn({ scope: String(id), property: 'fontStyle', detail: `font style "${v}" approximated as Regular` });
  return 400;
}

export function readEngineSnapshot(
  pages: EnginePage[],
  trees: Map<number, EngineNode>,
  docName: string,
): ReadbackResult {
  const warnings: ReadbackWarning[] = [];
  const warn = (w: ReadbackWarning): void => {
    warnings.push(w);
  };
  const docPages: DocPage[] = pages.map((p, i) => {
    const tree = trees.get(p.id);
    const objects: DesignObject[] = [];
    if (!tree) {
      warn({ scope: String(p.id), property: 'tree', detail: 'no snapshot for page; emitted empty' });
    } else {
      for (const c of tree.children) walk(c, null, objects, warn);
    }
    return { id: `mp${i}`, name: p.name, objects };
  });
  const doc: UndesignDoc = {
    version: 1,
    name: docName,
    pages: docPages,
    activePageId: docPages[0]?.id ?? 'mp0',
    components: [],
    variantSets: [],
    colorStyles: [],
    textStyles: [],
    effectStyles: [],
    prototypeLinks: [],
  };
  return { doc, warnings };
}
