import type { DesignObject, UndesignDoc } from './types';
import { uid } from './utils';

const SANS = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

function base(partial: Partial<DesignObject> & Pick<DesignObject, 'id' | 'type'>): DesignObject {
  return {
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
    stroke: '',
    strokeWidth: 0,
    cornerRadius: 0,
    clip: false,
    text: '',
    fontFamily: SANS,
    fontSize: 16,
    fontWeight: 400,
    textAlign: 'left',
    lineHeight: 1.4,
    ...partial,
  };
}

/** Polished starter document built from real editable objects. */
export function createSampleDoc(): UndesignDoc {
  const pageId = uid('page');
  const posterPageId = uid('page');
  const o: DesignObject[] = [];
  const p2: DesignObject[] = [];

  // ---------- Landing hero frame ----------
  o.push(
    base({
      id: 's_hero', type: 'frame', name: 'Hero — Desktop',
      x: 72, y: 72, w: 1200, h: 780, fill: '#FFFFFF', stroke: '#D9D9D9',
      strokeWidth: 1, cornerRadius: 4, clip: false,
    }),
  );
  const H = 's_hero';
  o.push(
    base({ id: 's_nav_brand', type: 'text', name: 'Brand', parentId: H, x: 48, y: 36, w: 200, h: 24, text: 'UNDESIGN®', fontSize: 15, fontWeight: 700, fill: '#111111' }),
    base({ id: 's_nav_links', type: 'text', name: 'Nav links', parentId: H, x: 760, y: 38, w: 392, h: 24, text: 'Work        Studio        Journal        Contact', fontSize: 13, fontWeight: 500, fill: '#555555', textAlign: 'right' }),
    base({ id: 's_nav_rule', type: 'line', name: 'Nav rule', parentId: H, x: 48, y: 76, w: 1104, h: 0, stroke: '#E4E4E4', strokeWidth: 1 }),
    base({ id: 's_eyebrow', type: 'text', name: 'Eyebrow', parentId: H, x: 48, y: 128, w: 520, h: 22, text: 'ISSUE 04 — AUTUMN CATALOGUE', fontFamily: MONO, fontSize: 12, fontWeight: 500, fill: '#6B6B6B' }),
    base({ id: 's_headline', type: 'text', name: 'Headline', parentId: H, x: 44, y: 168, w: 640, h: 260, text: 'Form\nfollows\nfunction.', fontFamily: SERIF, fontSize: 104, fontWeight: 400, fill: '#111111', lineHeight: 1.02 }),
    base({ id: 's_sub', type: 'text', name: 'Standfirst', parentId: H, x: 48, y: 500, w: 420, h: 72, text: 'A working design editor in your browser. Select anything on this canvas — every word and shape is editable.', fontSize: 16, fill: '#444444', lineHeight: 1.55 }),
    base({ id: 's_cta_primary', type: 'rectangle', name: 'CTA primary', parentId: H, x: 48, y: 600, w: 168, h: 48, fill: '#111111', cornerRadius: 24 }),
    base({ id: 's_cta_primary_t', type: 'text', name: 'CTA label', parentId: H, x: 48, y: 613, w: 168, h: 22, text: 'Start designing', fontSize: 14, fontWeight: 600, fill: '#FFFFFF', textAlign: 'center' }),
    base({ id: 's_cta_secondary', type: 'rectangle', name: 'CTA secondary', parentId: H, x: 228, y: 600, w: 168, h: 48, fill: '#FFFFFF', stroke: '#111111', strokeWidth: 1.5, cornerRadius: 24 }),
    base({ id: 's_cta_secondary_t', type: 'text', name: 'CTA label', parentId: H, x: 228, y: 613, w: 168, h: 22, text: 'View tour', fontSize: 14, fontWeight: 600, fill: '#111111', textAlign: 'center' }),
    base({ id: 's_stat1', type: 'text', name: 'Stat', parentId: H, x: 48, y: 700, w: 140, h: 44, text: '48\ncomponents', fontSize: 13, fill: '#555555', lineHeight: 1.4 }),
    base({ id: 's_stat2', type: 'text', name: 'Stat', parentId: H, x: 228, y: 700, w: 140, h: 44, text: '12\ntype styles', fontSize: 13, fill: '#555555', lineHeight: 1.4 }),
    base({ id: 's_stat3', type: 'text', name: 'Stat', parentId: H, x: 408, y: 700, w: 140, h: 44, text: '100%\neditable', fontSize: 13, fill: '#555555', lineHeight: 1.4 }),
    // Right-side visual composition
    base({ id: 's_disc', type: 'ellipse', name: 'Accent disc', parentId: H, x: 830, y: 120, w: 300, h: 300, fill: '#FF4D00' }),
    base({ id: 's_card', type: 'rectangle', name: 'Specimen card', parentId: H, x: 700, y: 300, w: 380, h: 320, fill: '#F4F4F2', stroke: '#111111', strokeWidth: 1.5, cornerRadius: 12 }),
    base({ id: 's_card_kicker', type: 'text', name: 'Card kicker', parentId: H, x: 732, y: 332, w: 316, h: 20, text: 'SPECIMEN — Aa', fontFamily: MONO, fontSize: 12, fill: '#6B6B6B' }),
    base({ id: 's_card_aa', type: 'text', name: 'Card Aa', parentId: H, x: 728, y: 348, w: 324, h: 150, text: 'Aa', fontFamily: SERIF, fontSize: 132, fill: '#111111' }),
    base({ id: 's_card_rule', type: 'line', name: 'Card rule', parentId: H, x: 732, y: 520, w: 316, h: 0, stroke: '#111111', strokeWidth: 1 }),
    base({ id: 's_card_meta', type: 'text', name: 'Card meta', parentId: H, x: 732, y: 536, w: 316, h: 60, text: 'Editorial serif / Grotesque pairing.\nSet solid, tracked tight.', fontSize: 13, fill: '#444444', lineHeight: 1.5 }),
    base({ id: 's_badge', type: 'ellipse', name: 'Badge', parentId: H, x: 668, y: 268, w: 84, h: 84, fill: '#111111' }),
    base({ id: 's_badge_t', type: 'text', name: 'Badge label', parentId: H, x: 668, y: 292, w: 84, h: 36, text: 'NEW\nv1.0', fontSize: 12, fontWeight: 700, fill: '#FFFFFF', textAlign: 'center', lineHeight: 1.3 }),
    base({ id: 's_caption', type: 'text', name: 'Caption', parentId: H, x: 700, y: 640, w: 380, h: 20, text: 'Fig. 01 — Composition, grid and accent', fontFamily: MONO, fontSize: 11, fill: '#8A8A8A', textAlign: 'center' }),
  );

  // ---------- Editorial poster frame ----------
  o.push(
    base({
      id: 's_poster', type: 'frame', name: 'Poster — Editorial',
      x: 1336, y: 72, w: 460, h: 640, fill: '#161616', cornerRadius: 4, clip: false,
    }),
  );
  const P = 's_poster';
  o.push(
    base({ id: 's_p_kicker', type: 'text', name: 'Kicker', parentId: P, x: 40, y: 40, w: 380, h: 20, text: 'UNDESIGN PRESENTS', fontFamily: MONO, fontSize: 12, fill: '#A8A8A8' }),
    base({ id: 's_p_title', type: 'text', name: 'Title', parentId: P, x: 36, y: 80, w: 390, h: 240, text: 'GRID /\nOFF-\nGRID', fontSize: 84, fontWeight: 800, fill: '#F5F5F3', lineHeight: 1.0 }),
    base({ id: 's_p_bar', type: 'rectangle', name: 'Accent bar', parentId: P, x: 40, y: 352, w: 96, h: 10, fill: '#FF4D00' }),
    base({ id: 's_p_body', type: 'text', name: 'Body', parentId: P, x: 40, y: 384, w: 300, h: 90, text: 'An exhibition of layouts that behave. Twelve rooms, one grid, endless deviation.', fontSize: 14, fill: '#CFCFCF', lineHeight: 1.6 }),
    base({ id: 's_p_circle', type: 'ellipse', name: 'Ring', parentId: P, x: 288, y: 470, w: 132, h: 132, fill: '', stroke: '#F5F5F3', strokeWidth: 1.5 }),
    base({ id: 's_p_dot', type: 'ellipse', name: 'Dot', parentId: P, x: 336, y: 518, w: 36, h: 36, fill: '#FF4D00' }),
    base({ id: 's_p_foot', type: 'text', name: 'Footer', parentId: P, x: 40, y: 576, w: 380, h: 20, text: 'OCT 12 — NOV 30 · HALL B', fontFamily: MONO, fontSize: 12, fill: '#A8A8A8' }),
  );

  // ---------- On-canvas hint (root level) ----------
  o.push(
    base({ id: 's_hint', type: 'text', name: 'Hint', parentId: null, x: 72, y: 884, w: 640, h: 24, text: 'Tip: drag to move · double-click text to edit · press R for rectangle, T for text', fontFamily: MONO, fontSize: 12, fill: '#8A8A8A' }),
  );

  // ---------- Second page: type specimen ----------
  p2.push(
    base({ id: 's_t_frame', type: 'frame', name: 'Type scale', parentId: null, x: 72, y: 72, w: 760, h: 560, fill: '#FFFFFF', stroke: '#D9D9D9', strokeWidth: 1, cornerRadius: 4 }),
  );
  const T = 's_t_frame';
  p2.push(
    base({ id: 's_t_k', type: 'text', name: 'Kicker', parentId: T, x: 48, y: 40, w: 664, h: 20, text: 'TYPE SCALE — 1.333 PERFECT FOURTH', fontFamily: MONO, fontSize: 12, fill: '#6B6B6B' }),
    base({ id: 's_t_1', type: 'text', name: 'Display', parentId: T, x: 44, y: 76, w: 668, h: 90, text: 'Display 64', fontSize: 64, fontWeight: 700, fill: '#111111' }),
    base({ id: 's_t_2', type: 'text', name: 'H1', parentId: T, x: 46, y: 176, w: 666, h: 64, text: 'Heading 48', fontSize: 48, fontWeight: 700, fill: '#111111' }),
    base({ id: 's_t_3', type: 'text', name: 'H2', parentId: T, x: 46, y: 248, w: 666, h: 52, text: 'Heading 36', fontSize: 36, fontWeight: 600, fill: '#222222' }),
    base({ id: 's_t_4', type: 'text', name: 'Body', parentId: T, x: 48, y: 312, w: 600, h: 60, text: 'Body 16 — The quick brown fox jumps over the lazy dog.', fontSize: 16, fill: '#333333' }),
    base({ id: 's_t_5', type: 'text', name: 'Small', parentId: T, x: 48, y: 384, w: 600, h: 30, text: 'Small 13 — Pack my box with five dozen liquor jugs.', fontSize: 13, fill: '#555555' }),
    base({ id: 's_t_rule', type: 'line', name: 'Rule', parentId: T, x: 48, y: 440, w: 664, h: 0, stroke: '#E4E4E4', strokeWidth: 1 }),
    base({ id: 's_t_sw1', type: 'rectangle', name: 'Ink', parentId: T, x: 48, y: 464, w: 64, h: 48, fill: '#111111', cornerRadius: 6 }),
    base({ id: 's_t_sw2', type: 'rectangle', name: 'Gray', parentId: T, x: 120, y: 464, w: 64, h: 48, fill: '#8A8A8A', cornerRadius: 6 }),
    base({ id: 's_t_sw3', type: 'rectangle', name: 'Paper', parentId: T, x: 192, y: 464, w: 64, h: 48, fill: '#F4F4F2', stroke: '#D9D9D9', strokeWidth: 1, cornerRadius: 6 }),
    base({ id: 's_t_sw4', type: 'rectangle', name: 'Accent', parentId: T, x: 264, y: 464, w: 64, h: 48, fill: '#FF4D00', cornerRadius: 6 }),
  );

  return {
    version: 1,
    name: 'Editorial starter',
    pages: [
      { id: pageId, name: 'Landing concept', objects: o },
      { id: posterPageId, name: 'Type specimen', objects: p2 },
    ],
    activePageId: pageId,
  };
}

/** Blank document used by File → New. */
export function createBlankDoc(): UndesignDoc {
  const pageId = uid('page');
  return {
    version: 1,
    name: 'Untitled',
    pages: [{ id: pageId, name: 'Page 1', objects: [] }],
    activePageId: pageId,
  };
}
