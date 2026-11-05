import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';
import { createAgentHandler, type AgentHandlerOptions } from '../api/_lib/agent-handler.js';
import { createMetaAdapter, isPublicAddress, META_ENDPOINT, META_MODEL_ID, type MetaTransportDependencies } from '../api/_lib/meta.js';
import { createSession, setSessionCookie, verifyCsrf, verifySession } from '../api/_lib/security.js';
import type { UsageStore } from '../api/_lib/usage-store.js';
import { createSessionHandler } from '../api/session.js';
import { createHealthHandler } from '../api/health.js';

const validBody = {
  model: META_MODEL_ID,
  messages: [
    { role: 'system', content: 'Return a plan as JSON.' },
    { role: 'user', content: 'A bouncing ball logo\nCanvas: none open\nSelection: none\n' },
  ],
  max_tokens: 500,
  response_format: { type: 'json_object' },
};
const upstreamOk = {
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: 1,
  model: META_MODEL_ID,
  choices: [{ index: 0, message: { role: 'assistant', content: '{"commands":[]}' }, finish_reason: 'stop' }],
};
const defaultEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  SESSION_SECRET: 'test-session-secret-do-not-use-in-production-000001',
  IP_HASH_SECRET: 'test-ip-hash-secret-is-independent-000000001',
  // Fictional test credential only; the test suite makes no real provider call.
  META_API_KEY: 'fictional-server-key-do-not-use-in-production',
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

interface TestContext {
  baseUrl: string;
  session: { cookie: string; csrf: string };
  server: Server;
}

async function withServer(
  options: AgentHandlerOptions,
  run: (context: TestContext) => Promise<void>,
): Promise<void> {
  const env = options.env ?? defaultEnv;
  const agent = createAgentHandler(options);
  const sessionHandler = createSessionHandler(env);
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/session')) void sessionHandler(req, res);
    else void agent(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const issued = await fetch(`${baseUrl}/api/session`, { method: 'POST', headers: { Origin: baseUrl } });
    assert.equal(issued.status, 200);
    const setCookie = issued.headers.get('set-cookie');
    assert.ok(setCookie);
    const cookie = setCookie.split(';', 1)[0]!;
    const sessionBody = await issued.json() as { csrfToken: string };
    await run({ baseUrl, session: { cookie, csrf: sessionBody.csrfToken }, server });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function authorizedHeaders(baseUrl: string, session: TestContext['session']): Record<string, string> {
  return {
    Origin: baseUrl,
    'Content-Type': 'application/json',
    Cookie: session.cookie,
    'X-CSRF-Token': session.csrf,
  };
}

async function post(baseUrl: string, session: TestContext['session'], body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}/api/agent`, {
    method: 'POST',
    headers: { ...authorizedHeaders(baseUrl, session), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function successAdapter(seen?: Array<{ payload: Record<string, unknown> }>) {
  return async (payload: Record<string, unknown>) => {
    seen?.push({ payload });
    return jsonResponse(upstreamOk);
  };
}

test('session cookie is signed, HttpOnly, SameSite=Strict, refreshable and CSRF is short-lived', async () => {
  const secret = defaultEnv.SESSION_SECRET!;
  const issued = createSession(secret, 1_800_000_000_000);
  const claims = verifySession(issued.cookieValue, secret, 1_800_000_000_000);
  assert.ok(claims);
  assert.equal(verifyCsrf(issued.csrfToken, claims, secret, 1_800_000_000_000), true);
  assert.equal(verifySession(`${issued.cookieValue}x`, secret, 1_800_000_000_000), undefined);
  assert.equal(verifySession(issued.cookieValue, secret, issued.expiresAt + 1), undefined);
  assert.equal(verifyCsrf(issued.csrfToken, claims, secret, issued.expiresAt), false);
  assert.match(setSessionCookie({ NODE_ENV: 'production' }, issued.cookieValue), /; Secure/);
  await withServer({ env: { ...defaultEnv }, adapter: successAdapter() }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/session`, { method: 'POST', headers: { Origin: baseUrl } });
    const cookie = response.headers.get('set-cookie') ?? '';
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ['csrfToken', 'expiresAt']);
  });
});

test('public guest request needs no provider key and is forwarded through the server adapter', async () => {
  let upstreamCalls = 0;
  let reservations = 0;
  const store: UsageStore = { async reserveRequest() { reservations += 1; return { allowed: true }; } };
  await withServer({ env: { ...defaultEnv }, usageStore: store, adapter: async (payload) => {
    upstreamCalls += 1;
    assert.equal(payload.model, META_MODEL_ID);
    return jsonResponse(upstreamOk);
  } }, async ({ baseUrl, session }) => {
    const response = await post(baseUrl, session, validBody);
    assert.equal(response.status, 200);
    assert.equal(upstreamCalls, 1);
    assert.equal(reservations, 1);
  });
});

test('session and CSRF are mandatory and exact origins are enforced', async () => {
  await withServer({ env: { ...defaultEnv }, adapter: successAdapter() }, async ({ baseUrl, session }) => {
    const noCsrf = await post(baseUrl, session, validBody, { 'X-CSRF-Token': '' });
    assert.equal(noCsrf.status, 403);
    const noCookie = await post(baseUrl, session, validBody, { Cookie: '' });
    assert.equal(noCookie.status, 403);
    const badOrigin = await post(baseUrl, session, validBody, { Origin: 'http://127.0.0.1:1' });
    assert.equal(badOrigin.status, 403);
    const absentOrigin = await fetch(`${baseUrl}/api/agent`, {
      method: 'POST', headers: { ...authorizedHeaders(baseUrl, session), Origin: '' }, body: JSON.stringify(validBody),
    });
    assert.equal(absentOrigin.status, 403);
  });
});

test('every public request uses fixed quota limits that client headers and env overrides cannot bypass', async () => {
  const hashes: string[] = [];
  const limitsSeen: Array<{ perIpPerMinute: number; globalPerDay: number }> = [];
  let calls = 0;
  const store: UsageStore = {
    async reserveRequest(ipHash, _nowMs, limits) {
      hashes.push(ipHash);
      limitsSeen.push(limits);
      calls += 1;
      return calls <= 1 ? { allowed: true } : { allowed: false, reason: 'RATE_LIMITED' };
    },
  };
  let upstreamCalls = 0;
  await withServer({ env: { ...defaultEnv, RATE_LIMIT_PER_MIN: '99', DAILY_BUDGET_REQUESTS: '999' }, usageStore: store, adapter: async () => { upstreamCalls += 1; return jsonResponse(upstreamOk); } }, async ({ baseUrl, session }) => {
    const first = await post(baseUrl, session, validBody, { 'X-Forwarded-For': '198.51.100.10' });
    const second = await post(baseUrl, session, validBody, { 'X-Forwarded-For': '198.51.100.10', 'X-User-Key': 'ignored-client-value' });
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal((await second.json() as { error: { code: string } }).error.code, 'RATE_LIMITED');
    assert.equal(calls, 2);
    assert.equal(upstreamCalls, 1);
    assert.equal(hashes.length, 2);
    assert.ok(hashes.every((hash) => /^[a-f\d]{64}$/.test(hash)));
    assert.ok(hashes.every((hash) => !hash.includes('198.51.100.10')));
    assert.deepEqual(limitsSeen, [
      { perIpPerMinute: 6, globalPerDay: 100 },
      { perIpPerMinute: 6, globalPerDay: 100 },
    ]);
  });
});

test('server provider key never appears in the browser payload or relay response', async () => {
  const secret = defaultEnv.META_API_KEY!;
  const seen: Array<{ payload: Record<string, unknown> }> = [];
  await withServer({ env: { ...defaultEnv }, adapter: successAdapter(seen) }, async ({ baseUrl, session }) => {
    const response = await post(baseUrl, session, validBody);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(text.includes(secret), false);
    assert.equal(JSON.stringify(seen[0]?.payload).includes(secret), false);
  });
});

test('OpenAI tool-call history is preserved with the fixed Muse model ID', async () => {
  const seen: Array<{ payload: Record<string, unknown> }> = [];
  const payload = {
    model: META_MODEL_ID,
    messages: [
      { role: 'system', content: 'Use tools when appropriate.' },
      { role: 'user', content: 'What is 2 + 2?' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'calculator', arguments: '{"expression":"2 + 2"}' } }] },
      { role: 'tool', tool_call_id: 'call-1', content: '4' },
      { role: 'assistant', content: 'The answer is 4.' },
    ],
    tools: [{ type: 'function', function: { name: 'calculator', description: 'Evaluate arithmetic.', parameters: { type: 'object', properties: { expression: { type: 'string' } } } } }],
    tool_choice: 'auto',
    stream: false,
    max_tokens: 2_000,
    n: 1,
  };
  await withServer({ env: { ...defaultEnv }, adapter: successAdapter(seen) }, async ({ baseUrl, session }) => {
    const response = await post(baseUrl, session, payload);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), upstreamOk);
    assert.deepEqual(seen[0]?.payload, payload);
  });
});

test('invalid payloads and streaming are rejected while response_format remains optional', async () => {
  let upstreamCalls = 0;
  await withServer({ env: { ...defaultEnv }, adapter: async () => { upstreamCalls += 1; return jsonResponse(upstreamOk); } }, async ({ baseUrl, session }) => {
    const noFormat = { model: META_MODEL_ID, messages: [{ role: 'user', content: 'hello' }] };
    assert.equal((await post(baseUrl, session, noFormat)).status, 200);
    assert.equal((await post(baseUrl, session, { ...noFormat, model: 'client-selected-model' })).status, 400);
    assert.equal((await post(baseUrl, session, { ...noFormat, stream: true })).status, 400);
    assert.equal((await post(baseUrl, session, { ...noFormat, messages: [{ role: 'tool', content: 'orphan' }] })).status, 400);
    assert.equal(upstreamCalls, 1);
  });
});

test('output tokens are capped at 2,000 per request with exactly one completion', async () => {
  const seen: Array<Record<string, unknown>> = [];
  await withServer({ env: { ...defaultEnv }, adapter: async (payload) => { seen.push(payload); return jsonResponse(upstreamOk); } }, async ({ baseUrl, session }) => {
    const base = { model: META_MODEL_ID, messages: [{ role: 'user', content: 'hello' }] };
    assert.equal((await post(baseUrl, session, base)).status, 200);
    assert.equal((await post(baseUrl, session, { ...base, max_tokens: 9_000, max_completion_tokens: 4_000, n: 1 })).status, 200);
    assert.equal((await post(baseUrl, session, { ...base, max_tokens: 500, n: 2 })).status, 400);
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.max_tokens, 2_000);
    assert.equal(seen[0]?.n, 1);
    assert.equal(seen[1]?.max_tokens, 2_000);
    assert.equal(seen[1]?.max_completion_tokens, 2_000);
    assert.equal(seen[1]?.n, 1);
  });
});

test('provider credentials and endpoint fields are rejected from the JSON body', async () => {
  let upstreamCalls = 0;
  await withServer({ env: { ...defaultEnv }, adapter: async () => { upstreamCalls += 1; return jsonResponse(upstreamOk); } }, async ({ baseUrl, session }) => {
    for (const field of ['api_key', 'authorization', 'endpoint', 'url', 'headers']) {
      const response = await post(baseUrl, session, { ...validBody, [field]: 'must-not-be-forwarded' });
      assert.equal(response.status, 400, `${field} must be rejected`);
      assert.equal((await response.json() as { error: { code: string } }).error.code, 'UNSUPPORTED_FIELD');
    }
    assert.equal(upstreamCalls, 0);
  });
});

test('quota store failures and upstream details are sanitized', async () => {
  const failedStore: UsageStore = { async reserveRequest() { throw new Error('do not disclose store connection details'); } };
  await withServer({ env: { ...defaultEnv }, usageStore: failedStore, adapter: successAdapter() }, async ({ baseUrl, session }) => {
    const response = await post(baseUrl, session, validBody);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: 'QUOTA_STORE_UNAVAILABLE', message: 'The request quota service is temporarily unavailable.' } });
  });
  await withServer({ env: { ...defaultEnv }, adapter: async () => jsonResponse({ error: 'provider leaked fictional-secret' }, 401) }, async ({ baseUrl, session }) => {
    const response = await post(baseUrl, session, validBody);
    assert.equal(response.status, 503);
    const text = await response.text();
    assert.equal(text.includes('provider leaked'), false);
    assert.equal(text.includes('fictional-secret'), false);
  });
});

test('fixed endpoint DNS resolution is checked and the validated public IP is TLS-pinned', async () => {
  assert.equal(META_ENDPOINT, 'https://api.meta.ai/v1/chat/completions');
  assert.equal(isPublicAddress('8.8.8.8', 4), true);
  assert.equal(isPublicAddress('127.0.0.1', 4), false);
  assert.equal(isPublicAddress('169.254.169.254', 4), false);
  assert.equal(isPublicAddress('2606:4700:4700::1111', 6), true);
  assert.equal(isPublicAddress('::1', 6), false);
  const seen: Array<{ options: import('node:https').RequestOptions; body: string }> = [];
  const deps: MetaTransportDependencies = {
    resolve: async (host) => {
      assert.equal(host, 'api.meta.ai');
      return [{ address: '8.8.8.8', family: 4 }];
    },
    request: async (options, body) => { seen.push({ options, body }); return jsonResponse(upstreamOk); },
  };
  const adapter = createMetaAdapter(defaultEnv, deps);
  assert.ok(adapter);
  await adapter({ model: META_MODEL_ID, messages: [] }, new AbortController().signal);
  const options = seen[0]!.options;
  assert.equal(options.hostname, 'api.meta.ai');
  assert.equal(options.servername, 'api.meta.ai');
  assert.equal(options.protocol, 'https:');
  assert.equal(options.path, '/v1/chat/completions');
  assert.equal((options.headers as Record<string, string>).Authorization, `Bearer ${defaultEnv.META_API_KEY}`);
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(typeof options.lookup, 'function');
  const lookupFn = options.lookup as NonNullable<import('node:https').RequestOptions['lookup']>;
  const pinned = await new Promise<string>((resolve, reject) => {
    (lookupFn as (hostname: string, options: unknown, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => void)(
      'api.meta.ai', {}, (error, address) => error ? reject(error) : resolve(address),
    );
  });
  assert.equal(pinned, '8.8.8.8');
  assert.equal(seen[0]!.body, JSON.stringify({ model: META_MODEL_ID, messages: [] }));
});

test('fixed upstream rejects mixed public/private DNS answers before transport', async () => {
  let requestCalls = 0;
  const adapter = createMetaAdapter(defaultEnv, {
    resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.4', family: 4 }],
    request: async () => { requestCalls += 1; return jsonResponse(upstreamOk); },
  });
  assert.ok(adapter);
  await assert.rejects(() => adapter({ model: META_MODEL_ID, messages: [] }, new AbortController().signal));
  assert.equal(requestCalls, 0);
});

test('production fails closed without HTTPS origin, independent strong secrets and durable quota', async () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://showcase.example.test' };
  const server = createServer((req, res) => { void createAgentHandler({ env, adapter: successAdapter() })(req, res); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const origin = `https://showcase.example.test`;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/agent`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'RELAY_NOT_READY');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  const healthServer = createServer((req, res) => { void createHealthHandler(env)(req, res); });
  await new Promise<void>((resolve) => healthServer.listen(0, '127.0.0.1', resolve));
  const healthAddress = healthServer.address();
  assert.ok(healthAddress && typeof healthAddress === 'object');
  try {
    const health = await fetch(`http://127.0.0.1:${healthAddress.port}/api/health`);
    const body = await health.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ['hashReady', 'ok', 'originReady', 'quotaReady', 'sessionReady', 'upstreamReady'].sort());
    assert.ok(Object.values(body).every((value) => typeof value === 'boolean'));
  } finally {
    healthServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => healthServer.close((error) => error ? reject(error) : resolve()));
  }
  const { readiness } = await import('../api/_lib/security.js');
  assert.deepEqual(readiness(env, false), {
    sessionReady: false, originReady: true, hashReady: false, quotaReady: false, upstreamReady: false,
  });
});
