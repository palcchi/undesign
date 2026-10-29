/**
 * Design system foundation: shared color and text styles with linked values.
 * Editing a style updates every linked object in the same commit via the
 * propagate* passes; direct value edits detach the link (set the style id
 * null at the edit site). Runs inside applyDoc; ref-preserving when idle.
 */
import { autoTextHeight } from './utils';
import type { DesignObject, DropShadow, TextStyle, UndesignDoc } from './types';

export function propagateStyles(prev: UndesignDoc, next: UndesignDoc): UndesignDoc {
  const prevColors = new Map((prev.colorStyles ?? []).map((s) => [s.id, s.color]));
  const changed = new Map<string, string>();
  for (const s of next.colorStyles ?? []) {
    const old = prevColors.get(s.id);
    if (old !== undefined && old !== s.color) changed.set(s.id, s.color);
  }
  if (changed.size === 0) return next;
  let docChanged = false;
  const pages = next.pages.map((page) => {
    const hit = page.objects.some(
      (o) => o.fillStyleId !== null && o.fillStyleId !== undefined && changed.has(o.fillStyleId),
    );
    if (!hit) return page;
    docChanged = true;
    return {
      ...page,
      objects: page.objects.map((o) =>
        o.fillStyleId !== null && o.fillStyleId !== undefined && changed.has(o.fillStyleId)
          ? { ...o, fill: changed.get(o.fillStyleId) as string }
          : o,
      ),
    };
  });
  return docChanged ? { ...next, pages } : next;
}

/** Object types that carry an editable solid fill (style-capable). */
export function canHaveFillStyle(type: DesignObject['type']): boolean {
  return type === 'frame' || type === 'rectangle' || type === 'ellipse' || type === 'text';
}

export function textStyleValuesEqual(a: TextStyleValues, b: TextStyleValues): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.fontWeight === b.fontWeight &&
    a.textAlign === b.textAlign &&
    a.lineHeight === b.lineHeight
  );
}

export function propagateTextStyles(prev: UndesignDoc, next: UndesignDoc): UndesignDoc {
  const prevById = new Map((prev.textStyles ?? []).map((s) => [s.id, s]));
  const changed = new Map<string, TextStyle>();
  for (const s of next.textStyles ?? []) {
    const old = prevById.get(s.id);
    if (old !== undefined && !textStyleValuesEqual(old, s)) changed.set(s.id, s);
  }
  if (changed.size === 0) return next;
  let docChanged = false;
  const pages = next.pages.map((page) => {
    const hit = page.objects.some(
      (o) => o.textStyleId !== null && o.textStyleId !== undefined && changed.has(o.textStyleId),
    );
    if (!hit) return page;
    docChanged = true;
    return {
      ...page,
      objects: page.objects.map((o) => {
        const s =
          o.textStyleId !== null && o.textStyleId !== undefined
            ? changed.get(o.textStyleId)
            : undefined;
        if (!s) return o;
        return {
          ...o,
          fontFamily: s.fontFamily,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          textAlign: s.textAlign,
          lineHeight: s.lineHeight,
          h: autoTextHeight(o.text, s.fontSize, s.lineHeight),
        };
      }),
    };
  });
  return docChanged ? { ...next, pages } : next;
}

/** Object types that carry linked typography (style-capable). */
export function canHaveTextStyle(type: DesignObject['type']): boolean {
  return type === 'text';
}

export function shadowEqual(a: DropShadow, b: DropShadow): boolean {
  return (
    a.offsetX === b.offsetX &&
    a.offsetY === b.offsetY &&
    a.blur === b.blur &&
    (a.spread ?? 0) === (b.spread ?? 0) &&
    a.color === b.color &&
    a.opacity === b.opacity
  );
}

export function propagateEffectStyles(prev: UndesignDoc, next: UndesignDoc): UndesignDoc {
  const prevById = new Map((prev.effectStyles ?? []).map((s) => [s.id, s.shadow]));
  const changed = new Map<string, DropShadow>();
  for (const s of next.effectStyles ?? []) {
    const old = prevById.get(s.id);
    if (old !== undefined && !shadowEqual(old, s.shadow)) changed.set(s.id, { ...s.shadow });
  }
  if (changed.size === 0) return next;
  let docChanged = false;
  const pages = next.pages.map((page) => {
    const hit = page.objects.some(
      (o) => o.effectStyleId !== null && o.effectStyleId !== undefined && changed.has(o.effectStyleId),
    );
    if (!hit) return page;
    docChanged = true;
    return {
      ...page,
      objects: page.objects.map((o) => {
        const s =
          o.effectStyleId !== null && o.effectStyleId !== undefined
            ? changed.get(o.effectStyleId)
            : undefined;
        if (!s) return o;
        return { ...o, shadow: { ...s } };
      }),
    };
  });
  return docChanged ? { ...next, pages } : next;
}

/** Object types that can carry a drop shadow (lines excluded in v1). */
export function canHaveEffectStyle(type: DesignObject['type']): boolean {
  return type !== 'line';
}

/** Editable typography values of a text style (identity/name excluded). */
export interface TextStyleValues {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textAlign: TextStyle['textAlign'];
  lineHeight: number;
}

/** Read the style-shaped typography values off a text object. */
export function textStyleValuesOf(o: DesignObject): TextStyleValues {
  return {
    fontFamily: o.fontFamily,
    fontSize: o.fontSize,
    fontWeight: o.fontWeight,
    textAlign: o.textAlign,
    lineHeight: o.lineHeight,
  };
}

/**
 * Write new values into a text style. Linked objects update via the
 * propagateTextStyles pass in the same commit; unknown ids are no-ops.
 */
export function applyTextStyleValues(
  doc: UndesignDoc,
  styleId: string,
  values: TextStyleValues,
): UndesignDoc {
  const styles = doc.textStyles ?? [];
  if (!styles.some((s) => s.id === styleId)) return doc;
  return {
    ...doc,
    textStyles: styles.map((s) => (s.id === styleId ? { ...s, ...values } : s)),
  };
}

/**
 * Write a new shadow into an effect style. Linked objects update via the
 * propagateEffectStyles pass in the same commit; unknown ids are no-ops.
 */
export function applyEffectStyleShadow(
  doc: UndesignDoc,
  styleId: string,
  shadow: DropShadow,
): UndesignDoc {
  const styles = doc.effectStyles ?? [];
  if (!styles.some((s) => s.id === styleId)) return doc;
  return {
    ...doc,
    effectStyles: styles.map((s) => (s.id === styleId ? { ...s, shadow: { ...shadow } } : s)),
  };
}
