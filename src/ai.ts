/**
 * AI-assisted design boundary.
 *
 * The model never touches the document directly: it returns a JSON plan of
 * small edit operations, the plan is validated against a strict schema, the
 * user previews the result, and applying it goes through the same undoable
 * store path as any manual edit. There is no demo provider — without a
 * configured endpoint the UI says so and generation is disabled.
 */
import type { DesignObject, ObjectPatch } from './types';

/* ================= plan schema ================= */

export interface AiAddOp {
  op: 'add';
  type: 'frame' | 'rectangle' | 'ellipse' | 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  text?: string;
  fontSize?: number;
}

export interface AiSetFillOp {
  op: 'setFill';
  color: string;
}

export interface AiSetTextOp {
  op: 'setText';
  text: string;
}

export type AiEditOp = AiAddOp | AiSetFillOp | AiSetTextOp;

export const AI_MAX_OPS = 50;
const AI_MAX_TEXT = 500;
const AI_MAX_DIM = 4000;
const AI_MAX_COORD = 10000;
const HEX = /^#[0-9a-fA-F]{6}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Validate a raw model response into edit ops. Accepts `{ ops: [...] }`.
 * Unknown op names fail the whole plan — silently dropping operations would
 * apply something the model did not describe.
 */
export function validateAiPlan(raw: unknown): { ok: true; ops: AiEditOp[] } | { ok: false; error: string } {
  if (!isRecord(raw) || !Array.isArray(raw.ops)) {
    return { ok: false, error: 'The model did not return a plan object shaped like { "ops": [...] }.' };
  }
  if (raw.ops.length === 0) return { ok: false, error: 'The plan contains no operations.' };
  if (raw.ops.length > AI_MAX_OPS) {
    return { ok: false, error: `The plan has ${raw.ops.length} operations; at most ${AI_MAX_OPS} are allowed.` };
  }
  const ops: AiEditOp[] = [];
  for (let i = 0; i < raw.ops.length; i += 1) {
    const o = raw.ops[i];
    if (!isRecord(o) || typeof o.op !== 'string') {
      return { ok: false, error: `Operation ${i + 1} has no "op" name.` };
    }
    if (o.op === 'add') {
      const built = checkAdd(o, i);
      if ('error' in built) return built;
      ops.push(built);
    } else if (o.op === 'setFill') {
      if (typeof o.color !== 'string' || !HEX.test(o.color)) {
        return { ok: false, error: `Operation ${i + 1}: "color" must be a #rrggbb hex string.` };
      }
      ops.push({ op: 'setFill', color: o.color });
    } else if (o.op === 'setText') {
      if (typeof o.text !== 'string' || o.text.length === 0 || o.text.length > AI_MAX_TEXT) {
        return { ok: false, error: `Operation ${i + 1}: "text" must be 1–${AI_MAX_TEXT} characters.` };
      }
      ops.push({ op: 'setText', text: o.text });
    } else {
      return { ok: false, error: `Operation ${i + 1}: unknown op "${o.op}".` };
    }
  }
  return { ok: true, ops };
}

function checkAdd(o: Record<string, unknown>, i: number): AiAddOp | { ok: false; error: string } {
  const err = (msg: string) => ({ ok: false as const, error: `Operation ${i + 1}: ${msg}` });
  if (o.type !== 'frame' && o.type !== 'rectangle' && o.type !== 'ellipse' && o.type !== 'text') {
    return err('"type" must be frame, rectangle, ellipse, or text.');
  }
  const x = num(o.x);
  const y = num(o.y);
  const w = num(o.w);
  const h = num(o.h);
  if (x === null || y === null || Math.abs(x) > AI_MAX_COORD || Math.abs(y) > AI_MAX_COORD) {
    return err(`"x" and "y" must be finite numbers within ±${AI_MAX_COORD}.`);
  }
  if (w === null || h === null || w < 1 || h < 1 || w > AI_MAX_DIM || h > AI_MAX_DIM) {
    return err(`"w" and "h" must be between 1 and ${AI_MAX_DIM}.`);
  }
  const add: AiAddOp = { op: 'add', type: o.type, x, y, w, h };
  if (o.fill !== undefined) {
    if (typeof o.fill !== 'string' || !HEX.test(o.fill)) return err('"fill" must be a #rrggbb hex string.');
    add.fill = o.fill;
  }
  if (o.text !== undefined) {
    if (typeof o.text !== 'string' || o.text.length > AI_MAX_TEXT) {
      return err(`"text" must be at most ${AI_MAX_TEXT} characters.`);
    }
    add.text = o.text;
  }
  if (o.fontSize !== undefined) {
    const fs = num(o.fontSize);
    if (fs === null || fs < 6 || fs > 256) return err('"fontSize" must be between 6 and 256.');
    add.fontSize = fs;
  }
  return add;
}

/* ================= plan application ================= */

/** Build document objects for a plan's add ops (pure; placement happens in the store). */
export function buildAiObjects(ops: AiEditOp[], newId: () => string): DesignObject[] {
  return ops
    .filter((o): o is AiAddOp => o.op === 'add')
    .map((o, i) => ({
      type: o.type,
      name: `AI ${o.type} ${i + 1}`,
      parentId: null,
      id: newId(),
      x: o.x,
      y: o.y,
      w: o.w,
      h: o.h,
      rotation: 0,
      visible: true,
      locked: false,
      opacity: 1,
      fill: o.fill ?? (o.type === 'frame' ? '#FFFFFF' : o.type === 'text' ? '#111111' : '#D9D9D9'),
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
      imageId: null,
      componentId: null,
      sourceId: null,
      componentSnapshot: null,
      variant: null,
      exposedValues: null,
      imageName: '',
      naturalW: 0,
      naturalH: 0,
      clip: o.type === 'frame',
      text: o.text ?? (o.type === 'text' ? 'AI text' : ''),
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: o.fontSize ?? 16,
      fontWeight: 400,
      textAlign: 'left',
      lineHeight: 1.4,
    }));
}

/** Merge a plan's selection-edit ops into one patch (last op of each kind wins). */
export function aiSelectionPatch(ops: AiEditOp[]): ObjectPatch | null {
  let patch: ObjectPatch | null = null;
  for (const o of ops) {
    if (o.op === 'setFill') patch = { ...(patch ?? {}), fill: o.color, fillStyleId: null };
    if (o.op === 'setText') patch = { ...(patch ?? {}), text: o.text };
  }
  return patch;
}

/** One-line human summary of a validated plan for the preview step. */
export function summarizeAiPlan(ops: AiEditOp[]): string {
  const adds = ops.filter((o) => o.op === 'add').length;
  const edits = ops.length - adds;
  const parts: string[] = [];
  if (adds > 0) parts.push(`${adds} new object${adds === 1 ? '' : 's'}`);
  if (edits > 0) parts.push(`${edits} selection edit${edits === 1 ? '' : 's'}`);
  return parts.join(' + ');
}

/* ================= provider ================= */

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const EMPTY_AI_CONFIG: AiConfig = { baseUrl: '', apiKey: '', model: '' };

export function aiConfigured(c: AiConfig): boolean {
  return c.baseUrl.trim() !== '' && c.apiKey.trim() !== '' && c.model.trim() !== '';
}

const AI_KEY = 'undesign.ai-config';

/** Config lives in sessionStorage only: the key never touches the document or localStorage. */
export function loadAiConfig(): AiConfig {
  try {
    if (typeof sessionStorage === 'undefined') return { ...EMPTY_AI_CONFIG };
    const raw = sessionStorage.getItem(AI_KEY);
    if (!raw) return { ...EMPTY_AI_CONFIG };
    const p = JSON.parse(raw) as Partial<AiConfig>;
    return {
      baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : '',
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
      model: typeof p.model === 'string' ? p.model : '',
    };
  } catch {
    return { ...EMPTY_AI_CONFIG };
  }
}

export function saveAiConfig(c: AiConfig): void {
  try {
    sessionStorage.setItem(AI_KEY, JSON.stringify(c));
  } catch {
    // Private mode etc. — the config simply won't survive reloads.
  }
}

export const AI_SYSTEM_PROMPT = [
  'You generate edit plans for the Undesign vector design editor.',
  'Reply with a single JSON object shaped like { "ops": [...] } and nothing else.',
  'Coordinates are in design units on an infinite canvas; keep layouts compact (within a few hundred units).',
  'Available operations:',
  '- { "op": "add", "type": "frame" | "rectangle" | "ellipse" | "text", "x": n, "y": n, "w": n, "h": n, "fill"?: "#rrggbb", "text"?: string, "fontSize"?: n }',
  '- { "op": "setFill", "color": "#rrggbb" } — recolors the current selection',
  '- { "op": "setText", "text": string } — replaces text on the current selection',
  `At most ${AI_MAX_OPS} operations. Sizes between 1 and ${AI_MAX_DIM}; colors as lowercase #rrggbb.`,
].join('\n');

/**
 * Call an OpenAI-compatible chat-completions endpoint and parse the plan JSON.
 * The caller owns the AbortSignal (timeout/cancel); HTTP and JSON failures
 * surface as Errors with the server message attached when available.
 */
export async function generateAiPlan(
  cfg: AiConfig,
  brief: string,
  selectionSummary: string,
  signal: AbortSignal,
): Promise<unknown> {
  if (typeof fetch === 'undefined') throw new Error('Network requests are unavailable in this environment.');
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: `Brief: ${brief}\nCurrent selection: ${selectionSummary}` },
        ],
      }),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('Request cancelled.');
    throw new Error(`Could not reach the AI endpoint at ${cfg.baseUrl}.`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`The AI endpoint rejected the request (HTTP ${res.status})${body ? `: ${body.slice(0, 200)}` : ''}.`);
  }
  const data = (await res.json().catch(() => null) as unknown) as {
    choices?: { message?: { content?: string } }[];
  } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('The AI endpoint returned an empty response.');
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error('The AI endpoint returned malformed JSON.');
  }
}
