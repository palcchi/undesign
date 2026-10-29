/**
 * UND→FC document conversion: replays an Undesign document into the engine
 * through its real command API (create + node.set per object).
 *
 * Representable attributes are preserved: pages, names, hierarchy, geometry,
 * rotation, fills, strokes, corner radii, opacity, visibility, lock, clip,
 * and text content with typography. Everything else produces an explicit
 * {@link ConvertWarning} — user data is never silently discarded.
 *
 * The emission here mirrors `migration_script_builds_a_full_page` in
 * `rust/src/lib.rs`, which proves the same sequence against the real engine.
 */
import type { DesignObject, UndesignDoc } from '../types';

export interface ConvertApi {
  execute(cmd: string, params: Record<string, unknown>): unknown;
}

export interface ConvertWarning {
  /** UND object id (or page/doc scope marker). */
  scope: string;
  property: string;
  detail: string;
}

export interface ConvertResult {
  warnings: ConvertWarning[];
  pages: number;
  objects: number;
  skipped: number;
}

function resultId(out: unknown, cmd: string): number {
  if (typeof out === 'object' && out !== null && typeof (out as { id?: unknown }).id === 'number') {
    return (out as { id: number }).id;
  }
  throw new Error(`${cmd} returned no id`);
}

/** Parent-first order; cyclic/dangling parents degrade to roots with warnings. */
function orderParentFirst(objects: DesignObject[], warn: (w: ConvertWarning) => void): DesignObject[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const depth = new Map<string, number>();
  const visit = (o: DesignObject, trail: Set<string>): number => {
    const known = depth.get(o.id);
    if (known !== undefined) return known;
    if (trail.has(o.id)) {
      warn({ scope: o.id, property: 'parentId', detail: 'cyclic parent chain; placed at page root' });
      depth.set(o.id, 0);
      return 0;
    }
    if (o.parentId === null || o.parentId === undefined) {
      depth.set(o.id, 0);
      return 0;
    }
    const parent = byId.get(o.parentId);
    if (!parent) {
      warn({ scope: o.id, property: 'parentId', detail: `dangling parent ${o.parentId}; placed at page root` });
      depth.set(o.id, 0);
      return 0;
    }
    trail.add(o.id);
    const d = visit(parent, trail) + 1;
    trail.delete(o.id);
    if (d > 64) {
      warn({ scope: o.id, property: 'parentId', detail: 'parent chain exceeds 64 levels; placed at page root' });
      depth.set(o.id, 0);
      return 0;
    }
    depth.set(o.id, d);
    return d;
  };
  for (const o of objects) visit(o, new Set());
  return [...objects].sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0));
}

function fillsFor(o: DesignObject, warn: (w: ConvertWarning) => void): Record<string, unknown> {
  if (o.fillGradient) {
    warn({ scope: o.id, property: 'fillGradient', detail: 'gradient approximated by its solid fallback color' });
  }
  if (o.fill === '') return { fills: [] };
  // Paint objects require an explicit type; bare {color} is rejected.
  if (o.fillOpacity < 1) return { fills: [{ type: 'solid', color: o.fill, opacity: o.fillOpacity }] };
  return { fill: o.fill };
}

function strokesFor(o: DesignObject): Record<string, unknown> {
  if (o.stroke === '') return { strokes: [] };
  return { stroke: o.stroke, strokeWeight: Math.max(0, o.strokeWidth) };
}

function cornersFor(o: DesignObject): Record<string, unknown> {
  if (o.cornerRadii) {
    const [tl, tr, br, bl] = o.cornerRadii;
    return { topLeftRadius: tl, topRightRadius: tr, bottomRightRadius: br, bottomLeftRadius: bl };
  }
  if (o.cornerRadius > 0) return { cornerRadius: o.cornerRadius };
  return {};
}

/** Warn about (and skip) semantic layers the converter still flattens. */
function styleWarnings(o: DesignObject, warn: (w: ConvertWarning) => void): void {
  if (o.fillStyleId) warn({ scope: o.id, property: 'fillStyleId', detail: 'color style link dropped; resolved fill value kept' });
  if (o.textStyleId) warn({ scope: o.id, property: 'textStyleId', detail: 'text style link dropped; resolved type values kept' });
  if (o.effectStyleId) warn({ scope: o.id, property: 'effectStyleId', detail: 'effect style link dropped' });
  if (o.shadow) warn({ scope: o.id, property: 'shadow', detail: 'drop shadow not migrated' });
  // The engine only allows auto-layout on frames; anywhere else the layout
  // block is recorded and skipped instead of failing the import.
  if (o.layout && o.type !== 'frame') {
    warn({ scope: o.id, property: 'layout', detail: `auto-layout on a ${o.type} skipped (the engine needs a frame)` });
  }
  if (o.componentId && (o.sourceId === null || o.sourceId === undefined)) {
    warn({ scope: o.id, property: 'componentId', detail: 'instance flattened to plain layers' });
  }
}

const MAIN_ALIGN: Record<string, string> = { start: 'min', center: 'center', end: 'max', 'space-between': 'spaceBetween' };
const CROSS_ALIGN: Record<string, string> = { start: 'min', center: 'center', end: 'max' };
const CONSTRAINT_H: Record<string, string> = { left: 'left', center: 'center', right: 'right', stretch: 'leftRight', scale: 'scale' };
const CONSTRAINT_V: Record<string, string> = { top: 'top', middle: 'center', bottom: 'bottom', stretch: 'topBottom', scale: 'scale' };

/**
 * UND auto-layout, child sizing, and constraints map onto engine `node.set`
 * keys (`layout`, `gap`, `padding*`, `mainAlign`, `crossAlign`, `sizingH/V`,
 * `min/maxWidth/Height`, `absolute`, `constraints`), so they migrate instead
 * of warning — except where the engine refuses them: `fill` needs an
 * auto-layout parent and `hug` needs layout (or text) on the node itself.
 * Refused modes come back in `sizingSkipped` for an explicit warning; the
 * import never fails on them.
 */
function layoutPropsFor(
  o: DesignObject,
  parentHasLayout: boolean,
): { props: Record<string, unknown>; sizingSkipped: string[] } {
  const props: Record<string, unknown> = {};
  const sizingSkipped: string[] = [];
  const selfLayouts = (o.type === 'frame' && o.layout !== null) || o.type === 'text';
  if (o.type === 'frame' && o.layout) {
    props.layout = o.layout.direction;
    props.gap = o.layout.gap;
    props.paddingTop = o.layout.paddingTop;
    props.paddingRight = o.layout.paddingRight;
    props.paddingBottom = o.layout.paddingBottom;
    props.paddingLeft = o.layout.paddingLeft;
    props.mainAlign = MAIN_ALIGN[o.layout.alignMain] ?? 'min';
    props.crossAlign = CROSS_ALIGN[o.layout.alignCross] ?? 'min';
  }
  if (o.sizing) {
    const modes: Array<[string, 'h' | 'v']> = [['sizingH', 'h'], ['sizingV', 'v']];
    for (const [key, axis] of modes) {
      const mode = axis === 'h' ? o.sizing.h : o.sizing.v;
      if (mode === 'fill' && !parentHasLayout) {
        sizingSkipped.push(`${axis}=fill without an auto-layout parent`);
        continue;
      }
      if (mode === 'hug' && !selfLayouts) {
        sizingSkipped.push(`${axis}=hug on a non-layout ${o.type}`);
        continue;
      }
      props[key] = mode;
    }
    if (o.sizing.minW !== null) props.minWidth = o.sizing.minW;
    if (o.sizing.maxW !== null) props.maxWidth = o.sizing.maxW;
    if (o.sizing.minH !== null) props.minHeight = o.sizing.minH;
    if (o.sizing.maxH !== null) props.maxHeight = o.sizing.maxH;
    if (o.sizing.absolute) props.absolute = true;
  }
  if (o.constraints) {
    props.constraints = {
      horizontal: CONSTRAINT_H[o.constraints.horizontal] ?? 'left',
      vertical: CONSTRAINT_V[o.constraints.vertical] ?? 'top',
    };
  }
  return { props, sizingSkipped };
}

export function convertUndesignToEngine(doc: UndesignDoc, api: ConvertApi): ConvertResult {
  const warnings: ConvertWarning[] = [];
  const warn = (w: ConvertWarning): void => {
    warnings.push(w);
  };
  if (doc.components.length > 0) {
    warn({ scope: 'doc', property: 'components', detail: `${doc.components.length} component def(s) not migrated in Phase 2` });
  }
  if (doc.variantSets.length > 0) {
    warn({ scope: 'doc', property: 'variantSets', detail: `${doc.variantSets.length} variant set(s) not migrated in Phase 2` });
  }
  if (doc.colorStyles.length + doc.textStyles.length + doc.effectStyles.length > 0) {
    warn({ scope: 'doc', property: 'styles', detail: 'shared style defs not migrated; resolved values kept on objects' });
  }
  if (doc.prototypeLinks.length > 0) {
    warn({ scope: 'doc', property: 'prototypeLinks', detail: `${doc.prototypeLinks.length} prototype link(s) not migrated in Phase 2` });
  }

  // The engine boots with one page; rename it for the first UND page so the
  // migrated history never holds a deletion of the initial page.
  const firstList = api.execute('page.list', {}) as Array<{ id: number }>;
  if (!Array.isArray(firstList) || firstList.length === 0 || typeof firstList[0].id !== 'number') {
    throw new Error('page.list returned no pages');
  }
  let objects = 0;
  let skipped = 0;
  doc.pages.forEach((page, pageIndex) => {
    let pageId: number;
    if (pageIndex === 0) {
      pageId = firstList[0].id;
      api.execute('page.rename', { id: pageId, name: page.name });
    } else {
      pageId = resultId(api.execute('page.add', { name: page.name }), 'page.add');
    }
    api.execute('page.select', { id: pageId });
    const engineIds = new Map<string, number>();
    for (const o of orderParentFirst(page.objects, warn)) {
      styleWarnings(o, warn);
      const parent = o.parentId !== null && o.parentId !== undefined ? engineIds.get(o.parentId) : undefined;
      const base: Record<string, unknown> = { x: o.x, y: o.y, width: o.w, height: o.h };
      if (parent !== undefined) base.parent = parent;
      const props: Record<string, unknown> = { name: o.name };
      if (!o.visible) props.visible = false;
      if (o.locked) props.locked = true;
      if (o.opacity < 1) props.opacity = o.opacity;
      // UND rotation is clockwise-positive (SVG); the engine is
      // counter-clockwise-positive, so the sign flips at the boundary.
      if (o.rotation !== 0) props.rotation = -o.rotation;

      let cmd: string;
      let params: Record<string, unknown>;
      switch (o.type) {
        case 'frame':
          cmd = 'node.create';
          params = { type: 'frame', ...base };
          Object.assign(props, fillsFor(o, warn), cornersFor(o));
          if (o.clip) props.clip = true;
          break;
        case 'rectangle':
          cmd = 'shape.rectangle';
          params = { ...base };
          Object.assign(props, fillsFor(o, warn), strokesFor(o), cornersFor(o));
          break;
        case 'ellipse':
          cmd = 'shape.ellipse';
          params = { ...base };
          Object.assign(props, fillsFor(o, warn), strokesFor(o), cornersFor(o));
          break;
        case 'text':
          cmd = 'text.create';
          params = { text: o.text, x: o.x, y: o.y };
          if (parent !== undefined) params.parent = parent;
          Object.assign(props, {
            fontFamily: o.fontFamily,
            fontSize: o.fontSize,
            fontWeight: o.fontWeight,
            textAlign: o.textAlign,
            lineHeight: `${Math.round(o.lineHeight * 100)}%`,
          });
          Object.assign(props, fillsFor(o, warn));
          break;
        case 'line': {
          // Lines carry a bounding delta plus a center rotation; fold both
          // into the engine's center-based line angle (see the Rust
          // line_rotation test for the verified formula), negated for the
          // engine's counter-clockwise-positive convention.
          const len = Math.hypot(o.w, o.h);
          if (len < 1e-9) {
            skipped += 1;
            warn({ scope: o.id, property: 'geometry', detail: 'zero-length line skipped' });
            continue;
          }
          const total = -((Math.atan2(o.h, o.w) * 180) / Math.PI + o.rotation);
          const cx = o.x + o.w / 2;
          const cy = o.y + o.h / 2;
          cmd = 'shape.line';
          params = { x: cx - len / 2, y: cy, width: len, props: { rotation: total } };
          if (parent !== undefined) params.parent = parent;
          delete props.rotation;
          if (o.stroke === '') {
            // Engine lines are stroke-rendered; an unstroked UND line would
            // be invisible, so the engine default stroke is kept (no
            // strokes key is sent) and the substitution is recorded.
            warn({ scope: o.id, property: 'stroke', detail: 'unstroked line kept the engine default stroke' });
          } else {
            Object.assign(props, strokesFor(o));
          }
          break;
        }
        case 'image':
          // No image primitive is mapped in Phase 2; keep a named
          // placeholder so layout and hierarchy survive, and record it.
          cmd = 'shape.rectangle';
          params = { ...base };
          props.name = `${o.name} (image not migrated)`;
          Object.assign(props, { fills: [] });
          warn({ scope: o.id, property: 'imageId', detail: `image "${o.imageName || o.imageId || 'unnamed'}" replaced by a placeholder rect` });
          break;
        default:
          skipped += 1;
          warn({ scope: o.id, property: 'type', detail: `unsupported object type ${(o as DesignObject).type}; skipped` });
          continue;
      }
      const undParent = o.parentId !== null && o.parentId !== undefined ? page.objects.find((p) => p.id === o.parentId) : undefined;
      const parentHasLayout = undParent !== undefined && undParent.type === 'frame' && undParent.layout !== null;
      const laid = layoutPropsFor(o, parentHasLayout);
      Object.assign(props, laid.props);
      for (const skipped of laid.sizingSkipped) {
        warn({ scope: o.id, property: 'sizing', detail: `child sizing ${skipped}; kept fixed` });
      }
      const id = resultId(api.execute(cmd, params), cmd);
      engineIds.set(o.id, id);
      objects += 1;
      if (Object.keys(props).length > 0) {
        api.execute('node.set', { id, props });
      }
    }
  });
  const firstId = firstList[0].id;
  api.execute('page.select', { id: firstId });
  return { warnings, pages: doc.pages.length, objects, skipped };
}
