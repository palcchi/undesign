/**
 * Prototype interactions: click links between objects and frames.
 * One outgoing link per source; targets must be frames. Deleting an object
 * drops its links; validation keeps hand-edited documents safe.
 */
import type { DocPage, PrototypeLink } from './types';

/** Drop links whose source is gone or whose target is not a frame. */
export function pruneLinks(pages: DocPage[], links: PrototypeLink[]): PrototypeLink[] {
  const byId = new Map<string, string>();
  for (const p of pages) {
    for (const o of p.objects) byId.set(o.id, o.type);
  }
  return links.filter((l) => byId.has(l.sourceId) && byId.get(l.targetFrameId) === 'frame');
}

/** The outgoing link of a source object, if any. */
export function outgoingLink(links: PrototypeLink[], sourceId: string): PrototypeLink | null {
  return links.find((l) => l.sourceId === sourceId) ?? null;
}

/** Set (or clear, with null) the outgoing link of a source object. */
export function setOutgoingLink(
  links: PrototypeLink[],
  sourceId: string,
  targetFrameId: string | null,
  newId: () => string,
): PrototypeLink[] {
  const kept = links.filter((l) => l.sourceId !== sourceId);
  if (targetFrameId === null) return kept.length === links.length ? links : kept;
  const existing = links.find((l) => l.sourceId === sourceId);
  if (existing && existing.targetFrameId === targetFrameId) return links;
  return [...kept, { id: existing?.id ?? newId(), sourceId, targetFrameId }];
}
