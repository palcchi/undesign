/** Core document model for Undesign. Kept JSON-serializable for persistence and undo. */

export type ObjectType = 'frame' | 'rectangle' | 'ellipse' | 'text' | 'line';

export type TextAlign = 'left' | 'center' | 'right';

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
  /** Stroke paint as CSS color, or '' for none. */
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  /** Clip children to bounds (frames only). */
  clip: boolean;
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
