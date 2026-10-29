/** Core document model for Undesign. Kept JSON-serializable for persistence and undo. */

export type ObjectType = 'frame' | 'rectangle' | 'ellipse' | 'text' | 'line' | 'image';

export type TextAlign = 'left' | 'center' | 'right';

/** One color stop in a linear gradient fill; offset is 0..1. */
export interface GradientStop {
  offset: number;
  color: string;
}

/**
 * Linear gradient fill. Angle 0 runs left-to-right, 90 top-to-bottom
 * (clockwise-positive in screen coordinates). Overrides the solid `fill`
 * when valid (at least two stops); the solid color is preserved underneath.
 */
export interface FillGradient {
  angle: number;
  stops: GradientStop[];
}

/** Per-corner radii in TL, TR, BR, BL order. */
export type CornerRadii = [number, number, number, number];

/**
 * Responsive behavior when the parent frame resizes. Each axis pins the near
 * edge (left/top), far edge (right/bottom), center, both edges (stretch), or
 * scales proportionally. Null = left/top defaults.
 */
export interface Constraints {
  horizontal: 'left' | 'center' | 'right' | 'stretch' | 'scale';
  vertical: 'top' | 'middle' | 'bottom' | 'stretch' | 'scale';
}

/** Shared fill color: editing the style updates every linked object. */
export interface ColorStyle {
  id: string;
  name: string;
  color: string;
}

/**
 * Prototype interaction: clicking the source navigates to the target frame
 * in present mode. V1 supports click triggers with instant transitions only.
 */
export interface PrototypeLink {
  id: string;
  sourceId: string;
  targetFrameId: string;
}

/**
 * A reusable component definition. The source lives on a real page as a
 * normal editable subtree; instances expand from it. Deleting the source
 * page detaches all instances (one undo step restores everything).
 */
export interface ComponentDef {
  id: string;
  name: string;
  pageId: string;
  rootId: string;
}

export type Tool =
  | 'select'
  | 'frame'
  | 'rectangle'
  | 'ellipse'
  | 'text'
  | 'line'
  | 'hand';

export interface Viewport {
  /** Scale factor, 1 = 100%. */
  zoom: number;
  /** Pan offset in screen pixels. screen = world * zoom + offset */
  x: number;
  y: number;
}

export interface DesignObject {
  id: string;
  type: ObjectType;
  name: string;
  /** Containing frame id, or null when placed directly on the page. */
  parentId: string | null;
  /** Position. Relative to the parent frame origin when parentId is set. */
  x: number;
  y: number;
  /** Size. For lines this is the bounding delta from the start point. */
  w: number;
  h: number;
  /** Rotation in degrees around the object center. */
  rotation: number;
  visible: boolean;
  locked: boolean;
  /** Whole-layer opacity 0..1. */
  opacity: number;
  /** Fill paint as CSS color, or '' for none. */
  fill: string;
  fillOpacity: number;
  /** Gradient fill override, or null for a solid fill. */
  fillGradient: FillGradient | null;
  /** Linked color style, or null. Direct fill edits detach the link. */
  fillStyleId: string | null;
  /** Responsive constraints within the parent frame, or null for defaults. */
  constraints: Constraints | null;
  /** Stroke paint as CSS color, or '' for none. */
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  /** Per-corner radii override, or null to use the uniform cornerRadius. */
  cornerRadii: CornerRadii | null;
  /** Clip children to bounds (frames only). */
  clip: boolean;
  // Component instance markers. Instance roots are frames with componentId
  // set; their expanded children carry sourceId. componentSnapshot records
  // the last expansion per source id so user edits survive source updates
  // as computed overrides (diff of current vs snapshot, reapplied over the
  // fresh expansion). All three are null on ordinary objects.
  componentId: string | null;
  sourceId: string | null;
  componentSnapshot: Record<string, DesignObject> | null;
  // Image properties (image objects only). The pixels live in the local
  // asset store keyed by imageId; the document carries only the reference
  // so JSON stays small and localStorage-safe.
  imageId: string | null;
  imageName: string;
  naturalW: number;
  naturalH: number;
  // Text properties (text objects only)
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textAlign: TextAlign;
  lineHeight: number;
}

export interface DocPage {
  id: string;
  name: string;
  objects: DesignObject[];
}

export interface UndesignDoc {
  version: 1;
  name: string;
  pages: DocPage[];
  activePageId: string;
  components: ComponentDef[];
  colorStyles: ColorStyle[];
  prototypeLinks: PrototypeLink[];
}

/** Patch accepted by object update actions. */
export type ObjectPatch = Partial<DesignObject>;

/** Alignment operations for multi-selection. */
export type AlignKind =
  | 'left'
  | 'centerX'
  | 'right'
  | 'top'
  | 'centerY'
  | 'bottom';

export type DistributeKind = 'horizontal' | 'vertical';
