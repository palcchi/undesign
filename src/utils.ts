import type { DesignObject, DocPage, UndesignDoc } from './types';

let counter = 0;

/** Short unique id, stable enough for document objects. */
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}${Math.floor(
    Math.random() * 1296,
  ).toString(36)}`;
}

export function cloneDoc(doc: UndesignDoc): UndesignDoc {
  return JSON.parse(JSON.stringify(doc)) as UndesignDoc;
}

export function getPage(doc: UndesignDoc, id?: string): DocPage {
  const page =
    doc.pages.find((p) => p.id === (id ?? doc.activePageId)) ?? doc.pages[0];
  if (!page) throw new Error('Document has no pages');
  return page;
}

export function childrenOf(objects: DesignObject[], parentId: string | null): DesignObject[] {
  return objects.filter((o) => o.parentId === parentId);
}

/** All descendant ids of an object (frames can nest). */
export function descendantIds(objects: DesignObject[], id: string): string[] {
  const direct = objects.filter((o) => o.parentId === id);
  const out: string[] = [];
  for (const child of direct) {
    out.push(child.id, ...descendantIds(objects, child.id));
  }
  return out;
}

/** Absolute page-space position of an object (walks up through frame parents). */
export function absolutePosition(
  objects: DesignObject[],
  obj: DesignObject,
): { x: number; y: number } {
  let x = obj.x;
  let y = obj.y;
  let current = obj;
  const byId = new Map(objects.map((o) => [o.id, o]));
  let guard = 0;
  while (current.parentId && guard < 100) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    x += parent.x;
    y += parent.y;
    current = parent;
    guard += 1;
  }
  return { x, y };
}

/** Axis-aligned bounds of visible objects in page space (rotation ignored). */
export function pageBounds(
  objects: DesignObject[],
): { x: number; y: number; w: number; h: number } | null {
  const visible = objects.filter((o) => o.visible);
  if (visible.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of visible) {
    const p = absolutePosition(objects, o);
    const w = o.type === 'line' ? Math.abs(o.w) : o.w;
    const h = o.type === 'line' ? Math.abs(o.h) : o.h;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + w);
    maxY = Math.max(maxY, p.y + h);
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Default display name for a new object of a type. */
export function defaultName(
  type: DesignObject['type'],
  objects: DesignObject[],
): string {
  const base =
    type === 'frame'
      ? 'Frame'
      : type === 'rectangle'
        ? 'Rectangle'
        : type === 'ellipse'
          ? 'Ellipse'
          : type === 'text'
            ? 'Text'
            : 'Line';
  const count = objects.filter((o) => o.type === type).length + 1;
  return `${base} ${count}`;
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value.trim());
}

export function normalizeHex(value: string, fallback: string): string {
  const v = value.trim();
  if (!isHexColor(v)) return fallback;
  if (v.length === 4) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toUpperCase();
  }
  return v.toUpperCase();
}

/** Convert world/page coordinates to screen coordinates. */
export function worldToScreen(
  wx: number,
  wy: number,
  viewport: { zoom: number; x: number; y: number },
): { x: number; y: number } {
  return { x: wx * viewport.zoom + viewport.x, y: wy * viewport.zoom + viewport.y };
}

/** Convert screen coordinates to world/page coordinates. */
export function screenToWorld(
  sx: number,
  sy: number,
  viewport: { zoom: number; x: number; y: number },
): { x: number; y: number } {
  return { x: (sx - viewport.x) / viewport.zoom, y: (sy - viewport.y) / viewport.zoom };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function objectToSvg(
  objects: DesignObject[],
  obj: DesignObject,
  indent: string,
): string {
  const kids = childrenOf(objects, obj.id);
  const inner = kids.map((k) => objectToSvg(objects, k, indent + '  ')).join('');
  const rot =
    obj.rotation !== 0
      ? ` rotate(${obj.rotation} ${(obj.x + obj.w / 2).toFixed(1)} ${(obj.y + obj.h / 2).toFixed(1)})`
      : '';
  const opacity = obj.opacity < 1 ? ` opacity="${obj.opacity}"` : '';
  const common = `${opacity}${rot ? ` transform="${rot.trim()}"` : ''}`;
  const cx = obj.x;
  const cy = obj.y;

  switch (obj.type) {
    case 'frame':
    case 'rectangle': {
      const fill = obj.fill ? obj.fill : 'none';
      const fillOp = obj.fillOpacity < 1 ? ` fill-opacity="${obj.fillOpacity}"` : '';
      const stroke = obj.stroke ? ` stroke="${obj.stroke}" stroke-width="${obj.strokeWidth}"` : '';
      const rx = obj.cornerRadius > 0 ? ` rx="${obj.cornerRadius}"` : '';
      const clipAttr =
        obj.type === 'frame' && obj.clip
          ? ` clip-path="inset(0 round ${obj.cornerRadius}px)"`
          : '';
      return `${indent}<g${common}${clipAttr}>\n${indent}  <rect x="${cx}" y="${cy}" width="${obj.w}" height="${obj.h}" fill="${fill}"${fillOp}${stroke}${rx} />\n${inner}${indent}</g>\n`;
    }
    case 'ellipse': {
      const fill = obj.fill ? obj.fill : 'none';
      const fillOp = obj.fillOpacity < 1 ? ` fill-opacity="${obj.fillOpacity}"` : '';
      const stroke = obj.stroke ? ` stroke="${obj.stroke}" stroke-width="${obj.strokeWidth}"` : '';
      return `${indent}<ellipse cx="${cx + obj.w / 2}" cy="${cy + obj.h / 2}" rx="${obj.w / 2}" ry="${obj.h / 2}" fill="${fill}"${fillOp}${stroke}${common} />\n`;
    }
    case 'text': {
      const anchor = obj.textAlign === 'center' ? 'middle' : obj.textAlign === 'right' ? 'end' : 'start';
      const tx = obj.textAlign === 'center' ? cx + obj.w / 2 : obj.textAlign === 'right' ? cx + obj.w : cx;
      const lines = obj.text.split('\n');
      const tspans = lines
        .map(
          (line, i) =>
            `${indent}  <tspan x="${tx}" dy="${i === 0 ? 0 : obj.fontSize * obj.lineHeight}">${escapeXml(line) || ' '}</tspan>`,
        )
        .join('\n');
      const fill = obj.fill ? obj.fill : '#111111';
      return `${indent}<text x="${tx}" y="${cy + obj.fontSize * 0.85}" font-family="${escapeXml(obj.fontFamily)}" font-size="${obj.fontSize}" font-weight="${obj.fontWeight}" text-anchor="${anchor}" fill="${fill}"${common}>\n${tspans}\n${indent}</text>\n`;
    }
    case 'line': {
      const stroke = obj.stroke ? obj.stroke : '#111111';
      return `${indent}<line x1="${cx}" y1="${cy}" x2="${cx + obj.w}" y2="${cy + obj.h}" stroke="${stroke}" stroke-width="${obj.strokeWidth || 1}" stroke-linecap="round"${common} />\n`;
    }
  }
}

/** Serialize a page (or a subset of root objects) to a standalone SVG document. */
export function pageToSvg(page: DocPage, onlyIds?: string[]): string {
  const roots = childrenOf(page.objects, null).filter(
    (o) => o.visible && (!onlyIds || onlyIds.includes(o.id)),
  );
  const bounds = pageBounds(
    onlyIds ? page.objects.filter((o) => onlyIds.includes(o.id)) : page.objects.filter((o) => o.visible),
  ) ?? { x: 0, y: 0, w: 800, h: 600 };
  const body = roots.map((o) => objectToSvg(page.objects, o, '  ')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(bounds.w)}" height="${Math.ceil(bounds.h)}" viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}">\n${body}</svg>\n`;
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
