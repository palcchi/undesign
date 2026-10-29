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

export type LayoutDirection = 'horizontal' | 'vertical';
export type MainAlign = 'start' | 'center' | 'end' | 'space-between';
export type CrossAlign = 'start' | 'center' | 'end';
export type SizingMode = 'fixed' | 'hug' | 'fill';

/**
 * Auto-layout container (frames only). Flow children arrange along
 * direction with gap/padding/alignment; absolute children skip flow and
 * keep constraint behavior on parent resize.
 */
export interface FrameLayout {
  direction: LayoutDirection;
  gap: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  alignMain: MainAlign;
  alignCross: CrossAlign;
}

/**
 * How a child behaves inside an auto-layout frame. Inert without a layout
 * parent. min/max clamp hug+fill sizes (fixed sizes stay user-exact).
 */
export interface ChildSizing {
  h: SizingMode;
  v: SizingMode;
  minW: number | null;
  maxW: number | null;
  minH: number | null;
  maxH: number | null;
  /** Absolute children skip flow and follow constraints instead. */
  absolute: boolean;
}

/** Shared fill color: editing the style updates every linked object. */
export interface ColorStyle {
  id: string;
  name: string;
  color: string;
}

/**
 * Shared typography: editing the style updates every linked text object.
 * Covers the type-only properties; fill color stays with color styles.
 */
export interface TextStyle {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textAlign: TextAlign;
  lineHeight: number;
}

/**
 * Drop shadow. Rendered with an SVG drop-shadow filter on canvas and
 * export (a dilate stage is added when spread > 0). v1 has no inner or
 * layered shadows — one drop shadow per object.
 */
export interface DropShadow {
  offsetX: number;
  offsetY: number;
  /** Blur radius in px, >= 0. */
  blur: number;
  /** Spread (choke expansion) in px, >= 0. */
  spread: number;
  color: string;
  /** Shadow opacity 0..1. */
  opacity: number;
}

/** Shared drop shadow: editing the style updates every linked object. */
export interface EffectStyle {
  id: string;
  name: string;
  shadow: DropShadow;
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
  /**
   * Exposed nested properties: alias -> nested target. Lets instances of
   * this def drive a nested instance's property without opening the source.
   */
  exposed: Record<string, NestedExpose>;
}

/** One exposed nested property: which nested instance and which of its props. */
export interface NestedExpose {
  /** Source node id of the nested instance root within the def's subtree. */
  instance: string;
  /** Property name on the nested instance's set. */
  prop: string;
}

/**
 * A component property definition. v1 kinds only: boolean props bind to a
 * layer's visibility, text props bind to a text layer's characters.
 */
export interface PropDef {
  name: string;
  kind: 'boolean' | 'text';
  default: boolean | string;
}

/**
 * A variant set groups component defs as switchable variants of one
 * component. variants[0] is the default (new instances, Assets insert).
 * bindings map a property name to the source layer name it drives; the
 * property kind decides the field (boolean → visible, text → text).
 */
export interface VariantSet {
  id: string;
  name: string;
  properties: PropDef[];
  /** ComponentDef ids; first entry is the default variant. */
  variants: string[];
  bindings: Record<string, string>;
}

/** An instance's variant membership: its set plus current property values. */
export interface InstanceVariant {
  setId: string;
  values: Record<string, boolean | string>;
}

export type Tool =
  | 'select'
  | 'hand'
  | 'frame'
  | 'rectangle'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'text'
  | 'line'
  | 'arrow';

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
  /** Linked text style (text objects only), or null. Direct type edits detach. */
  textStyleId: string | null;
  /** Drop shadow, or null for none. */
  shadow: DropShadow | null;
  /** Linked effect style, or null. Direct shadow edits detach the link. */
  effectStyleId: string | null;
  /** Responsive constraints within the parent frame, or null for defaults. */
  constraints: Constraints | null;
  /** Auto-layout container block (frames only), or null for free layout. */
  layout: FrameLayout | null;
  /** Child sizing inside an auto-layout parent, or null for fixed/free. */
  sizing: ChildSizing | null;
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
  /** Variant membership for instance roots (null on plain instances). */
  variant: InstanceVariant | null;
  /** Exposed nested-property values, keyed by alias (instance roots). */
  exposedValues: Record<string, boolean | string> | null;
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
  variantSets: VariantSet[];
  colorStyles: ColorStyle[];
  textStyles: TextStyle[];
  effectStyles: EffectStyle[];
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
