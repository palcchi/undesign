import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { requestHeader, sendError, sendJson, type Environment } from './http.js';
import { createMetaAdapter, META_MODEL_ID, type MetaAdapter, type MetaPayload } from './meta.js';
import { createSupabaseUsageStore } from './supabase-usage-store.js';
import { createIpHasher, createMemoryUsageStore, type UsageStore } from './usage-store.js';
import { isDurableQuotaConfigured, relayConfigurationReady, requestHasSessionAndCsrf, requestHasOrigin } from './security.js';

const DEFAULT_MAX_TOKENS = 2_000;
const DEFAULT_RATE_LIMIT = 6;
const DEFAULT_DAILY_BUDGET = 100;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_MESSAGE_CHARS = 48_000;
const MAX_UPSTREAM_BYTES = 1_000_000;
const UPSTREAM_TIMEOUT_MS = 20_000;

class RequestProblem extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && Array.from(value).length <= max;
}

function validateTools(value: unknown): void {
  if (!Array.isArray(value) || value.length > 32) throw new RequestProblem(400, 'INVALID_TOOLS', 'tools must contain at most 32 function definitions.');
  let total = 0;
  for (const tool of value) {
    if (!isRecord(tool) || tool.type !== 'function' || !isRecord(tool.function)
      || !boundedString(tool.function.name, 128) || tool.function.name.length === 0) {
      throw new RequestProblem(400, 'INVALID_TOOLS', 'tools must contain valid function definitions.');
    }
    if (tool.function.description !== undefined && !boundedString(tool.function.description, 4_000)) {
      throw new RequestProblem(400, 'INVALID_TOOLS', 'Tool descriptions exceed the allowed size.');
    }
    if (tool.function.parameters !== undefined && !isRecord(tool.function.parameters)) {
      throw new RequestProblem(400, 'INVALID_TOOLS', 'Tool parameters must be a JSON object.');
    }
    const serialized = JSON.stringify(tool.function.parameters ?? {});
    total += Buffer.byteLength(serialized, 'utf8');
    if (total > 32_768) throw new RequestProblem(400, 'INVALID_TOOLS', 'Tool definitions exceed the allowed size.');
  }
}

function validateToolCalls(value: unknown): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new RequestProblem(400, 'INVALID_TOOL_CALLS', 'assistant tool_calls must contain at most 32 entries.');
  }
  for (const item of value) {
    if (!isRecord(item) || !boundedString(item.id, 256) || item.id.length === 0 || item.type !== 'function'
      || !isRecord(item.function) || !boundedString(item.function.name, 128) || item.function.name.length === 0
      || !boundedString(item.function.arguments, 16_384)) {
      throw new RequestProblem(400, 'INVALID_TOOL_CALLS', 'assistant tool_calls contain an invalid function call.');
    }
  }
}

function validateResponseFormat(value: unknown): void {
  if (!isRecord(value)) throw new RequestProblem(400, 'INVALID_RESPONSE_FORMAT', 'response_format must be a supported JSON format.');
  if (value.type === 'json_object') return;
  if (value.type === 'json_schema' && isRecord(value.json_schema)
      && boundedString(value.json_schema.name, 128) && isRecord(value.json_schema.schema)) return;
  throw new RequestProblem(400, 'INVALID_RESPONSE_FORMAT', 'response_format must be json_object or a JSON schema.');
}

function validateMessages(value: unknown): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw new RequestProblem(400, 'INVALID_MESSAGES', 'messages must contain between 1 and 64 chat messages.');
  }
  let contentBytes = 0;
  for (const message of value) {
    if (!isRecord(message) || !['system', 'user', 'assistant', 'tool'].includes(String(message.role))) {
      throw new RequestProblem(400, 'INVALID_MESSAGES', 'messages contain an unsupported role or invalid item.');
    }
    const role = message.role;
    const hasCalls = message.tool_calls !== undefined;
    if (hasCalls) validateToolCalls(message.tool_calls);
    if (role === 'assistant') {
      if (message.content !== null && !boundedString(message.content, MAX_MESSAGE_CHARS)) {
        throw new RequestProblem(400, 'INVALID_MESSAGES', 'assistant content must be bounded text or null.');
      }
      if (message.content === null && !hasCalls) {
        throw new RequestProblem(400, 'INVALID_MESSAGES', 'null assistant content requires tool_calls.');
      }
    } else if (!boundedString(message.content, MAX_MESSAGE_CHARS)) {
      throw new RequestProblem(400, 'INVALID_MESSAGES', 'system, user, and tool content must be bounded text.');
    }
    if (role === 'tool' && (!boundedString(message.tool_call_id, 256) || message.tool_call_id.length === 0)) {
      throw new RequestProblem(400, 'INVALID_MESSAGES', 'tool messages require a bounded tool_call_id.');
    }
    if (message.name !== undefined && (!boundedString(message.name, 128) || message.name.length === 0)) {
      throw new RequestProblem(400, 'INVALID_MESSAGES', 'message name is invalid.');
    }
    if (typeof message.content === 'string') contentBytes += Buffer.byteLength(message.content, 'utf8');
    if (contentBytes > 60_000) throw new RequestProblem(400, 'INVALID_MESSAGES', 'Combined message content exceeds the allowed size.');
  }
}

function validatePayload(body: unknown): MetaPayload {
  if (!isRecord(body)) throw new RequestProblem(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  const allowedFields = new Set([
    'model', 'messages', 'tools', 'tool_choice', 'stream', 'response_format',
    'max_tokens', 'max_completion_tokens', 'temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'n', 'stop',
  ]);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new RequestProblem(400, 'UNSUPPORTED_FIELD', 'Request contains an unsupported field.');
  }
  if (body.model !== META_MODEL_ID) {
    throw new RequestProblem(400, 'MODEL_NOT_ALLOWED', 'This relay uses its configured Muse model.');
  }
  validateMessages(body.messages);
  if (body.stream !== undefined && body.stream !== false) {
    throw new RequestProblem(400, 'STREAM_UNSUPPORTED', 'stream must be false or omitted.');
  }
  if (body.tools !== undefined) validateTools(body.tools);
  if (body.tool_choice !== undefined) {
    const choice = body.tool_choice;
    if (!(choice === 'auto' || choice === 'none' || choice === 'required' || isRecord(choice))) {
      throw new RequestProblem(400, 'INVALID_TOOL_CHOICE', 'tool_choice must be auto, none, required, or a function object.');
    }
    if (!body.tools) throw new RequestProblem(400, 'INVALID_TOOL_CHOICE', 'tool_choice requires tools.');
  }
  if (body.response_format !== undefined) validateResponseFormat(body.response_format);

  const payload: MetaPayload = { ...body, model: META_MODEL_ID };
  const maxCap = DEFAULT_MAX_TOKENS;
  if (body.max_tokens === undefined && body.max_completion_tokens === undefined) payload.max_tokens = DEFAULT_MAX_TOKENS;
  payload.n = 1;
  for (const tokenField of ['max_tokens', 'max_completion_tokens']) {
    const value = body[tokenField];
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new RequestProblem(400, 'INVALID_MAX_TOKENS', `${tokenField} must be a finite integer.`);
      }
      payload[tokenField] = Math.min(maxCap, Math.max(1, value));
    }
  }
  for (const [field, low, high] of [['temperature', 0, 2], ['top_p', 0, 1], ['presence_penalty', -2, 2], ['frequency_penalty', -2, 2]] as const) {
    const value = body[field];
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new RequestProblem(400, `INVALID_${field.toUpperCase()}`, `${field} must be a finite number.`);
      payload[field] = Math.min(high, Math.max(low, value));
    }
  }
  if (body.n !== undefined && body.n !== 1) {
    throw new RequestProblem(400, 'INVALID_N', 'n must be 1 so the output-token limit applies per request.');
  }
  const stopValid = boundedString(body.stop, 512)
    || (Array.isArray(body.stop) && body.stop.length <= 4 && body.stop.every((item) => boundedString(item, 512)));
  if (body.stop !== undefined && !stopValid) {
    throw new RequestProblem(400, 'INVALID_STOP', 'stop must be a string or an array of at most four strings.');
  }
  return payload;
}

function clientIp(req: IncomingMessage): string {
  // The proxy's final forwarded address is consumed transiently and HMACed before quota storage.
  const forwarded = requestHeader(req, 'x-forwarded-for');
  const candidate = forwarded?.split(',').map((item) => item.trim()).filter(Boolean).at(-1);
  if (candidate && isIP(candidate)) return candidate;
  return req.socket.remoteAddress ?? 'unknown';
}

function usageLimits(): { perIpPerMinute: number; globalPerDay: number } {
  return { perIpPerMinute: DEFAULT_RATE_LIMIT, globalPerDay: DEFAULT_DAILY_BUDGET };
}

function errorForQuota(reason: 'RATE_LIMITED' | 'DAILY_BUDGET_EXCEEDED'): { retryAfter: string; message: string } {
  if (reason === 'RATE_LIMITED') return { retryAfter: '60', message: 'Request limit reached. Try again shortly.' };
  return { retryAfter: '86400', message: 'The daily request budget is exhausted. Try again tomorrow.' };
}

export interface AgentHandlerOptions {
  env?: Environment;
  usageStore?: UsageStore;
  adapter?: MetaAdapter;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

export function createAgentHandler(options: AgentHandlerOptions = {}) {
  const env = options.env ?? process.env;
  const configuredStore = env.NODE_ENV === 'production'
    ? createSupabaseUsageStore(env)
    : (options.usageStore ?? createSupabaseUsageStore(env));
  const usageStore = configuredStore ?? (env.NODE_ENV === 'production' ? undefined : createMemoryUsageStore());
  const durableStoreAvailable = Boolean(configuredStore && isDurableQuotaConfigured(env));
  const adapter = options.adapter ?? createMetaAdapter(env);
  let hashIp: ((ip: string) => string) | undefined;
  try { hashIp = createIpHasher(env); } catch { /* Readiness check below fails closed. */ }
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'POST') {
      sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Use POST for this endpoint.');
      return;
    }
    if (!requestHasOrigin(req, env)) {
      sendError(res, 403, 'ORIGIN_DENIED', 'Origin is not allowed.');
      return;
    }
    const quotaReady = env.NODE_ENV === 'production' ? durableStoreAvailable : Boolean(usageStore);
    if (!relayConfigurationReady(env, quotaReady) || !usageStore || !hashIp) {
      sendError(res, 503, 'RELAY_NOT_READY', 'The relay is not securely configured.');
      return;
    }

    if (!requestHasSessionAndCsrf(req, env)) {
      sendError(res, 403, 'SESSION_OR_CSRF_INVALID', 'A valid browser session and CSRF token are required.');
      return;
    }

    try {
      let quota;
      try {
        quota = await usageStore.reserveRequest(hashIp(clientIp(req)), Date.now(), usageLimits());
      } catch {
        sendError(res, 503, 'QUOTA_STORE_UNAVAILABLE', 'The request quota service is temporarily unavailable.');
        return;
      }
      if (!quota.allowed) {
        const limited = errorForQuota(quota.reason);
        res.setHeader('Retry-After', limited.retryAfter);
        sendError(res, 429, quota.reason, limited.message);
        return;
      }

      const contentType = requestHeader(req, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      if (contentType !== 'application/json') {
        sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
        return;
      }
      const rawBody = await readRequestBodyWithLimit(req, maxBodyBytes);
      let parsed: unknown;
      try { parsed = JSON.parse(rawBody); }
      catch { throw new RequestProblem(400, 'INVALID_JSON', 'Request body must contain valid JSON.'); }
      const payload = validatePayload(parsed);

      let upstream: Response;
      try {
        if (!adapter) throw new Error('server provider key is unavailable');
        upstream = await adapter(payload, AbortSignal.timeout(timeoutMs));
      } catch {
        sendError(res, 503, 'UPSTREAM_ERROR', 'The model service is temporarily unavailable.');
        return;
      }
      if (!upstream.ok) {
        try { await upstream.body?.cancel(); } catch { /* Never expose provider errors. */ }
        sendError(res, 503, 'UPSTREAM_ERROR', 'The model service is temporarily unavailable.');
        return;
      }
      try {
        const text = await readResponseWithLimit(upstream, MAX_UPSTREAM_BYTES);
        const responseBody: unknown = JSON.parse(text);
        if (!isRecord(responseBody)) throw new Error('invalid response');
        if (Array.isArray(responseBody.choices) && responseBody.choices.length > 1) throw new Error('provider returned multiple completions');
        if (isRecord(responseBody.usage) && typeof responseBody.usage.completion_tokens === 'number'
          && responseBody.usage.completion_tokens > DEFAULT_MAX_TOKENS) throw new Error('provider exceeded output-token limit');
        sendJson(res, 200, responseBody);
      } catch {
        sendError(res, 503, 'UPSTREAM_ERROR', 'The model service is temporarily unavailable.');
      }
    } catch (error) {
      if (error instanceof RequestProblem) {
        sendError(res, error.status, error.code, error.message);
        return;
      }
      sendError(res, 503, 'INTERNAL_ERROR', 'The request could not be completed.');
    }
  };
}

async function readRequestBodyWithLimit(req: IncomingMessage, limit: number): Promise<string> {
  const contentLength = req.headers['content-length'];
  if (typeof contentLength === 'string') {
    if (!/^\d+$/.test(contentLength)) throw new RequestProblem(400, 'INVALID_CONTENT_LENGTH', 'Content-Length is invalid.');
    if (Number(contentLength) > limit) {
      req.resume();
      throw new RequestProblem(413, 'BODY_TOO_LARGE', 'Request body exceeds the allowed size.');
    }
  }
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > limit) {
      tooLarge = true;
      chunks.length = 0;
    } else if (!tooLarge) chunks.push(buffer);
  }
  if (tooLarge) throw new RequestProblem(413, 'BODY_TOO_LARGE', 'Request body exceeds the allowed size.');
  return Buffer.concat(chunks).toString('utf8');
}

async function readResponseWithLimit(response: Response, limit: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error('upstream response exceeded size limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}
