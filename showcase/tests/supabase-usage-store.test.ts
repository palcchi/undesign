import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDurableQuotaConfigured } from '../api/_lib/security.js';
import { createSupabaseUsageStore } from '../api/_lib/supabase-usage-store.js';

const projectUrl = 'https://example-project.supabase.co';
const secretKey = 'sb_secret_mock_only_test_key';
const validEnvironment: NodeJS.ProcessEnv = {
  SUPABASE_URL: projectUrl,
  SUPABASE_SECRET_KEY: secretKey,
};

function mockFetch(): typeof fetch {
  return async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('durable quota requires a SUPABASE_SECRET_KEY and never falls back to service_role', () => {
  const legacyEnvironment: NodeJS.ProcessEnv = {
    SUPABASE_URL: projectUrl,
    SUPABASE_SERVICE_ROLE_KEY: 'eyJ.legacy.service-role-token',
  };
  assert.equal(createSupabaseUsageStore(legacyEnvironment, mockFetch()), undefined);
  assert.equal(isDurableQuotaConfigured(legacyEnvironment), false);

  assert.equal(createSupabaseUsageStore({ ...validEnvironment, SUPABASE_SECRET_KEY: 'eyJ.legacy.service-role-token' }, mockFetch()), undefined);
  assert.equal(isDurableQuotaConfigured({ ...validEnvironment, SUPABASE_SECRET_KEY: 'eyJ.legacy.service-role-token' }), false);

  assert.ok(createSupabaseUsageStore(validEnvironment, mockFetch()));
  assert.equal(isDurableQuotaConfigured(validEnvironment), true);
});

test('mocked quota RPC sends the secret key only as apikey and maps supported decisions', async () => {
  const rpcResults = [
    [{ allowed: true }],
    [{ allowed: false, reason: 'RATE_LIMITED' }],
    [{ allowed: false, reason: 'DAILY_BUDGET_EXCEEDED' }],
  ];
  const captured: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    captured.push({ url, init: init ?? {} });
    const body = rpcResults[captured.length - 1];
    assert.ok(body);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const store = createSupabaseUsageStore(validEnvironment, fetchImpl);
  assert.ok(store);

  const nowMs = Date.parse('2026-03-14T15:09:26.000Z');
  const ipHash = 'a'.repeat(64);
  const limits = { perIpPerMinute: 6, globalPerDay: 100 };
  assert.deepEqual(await store.reserveRequest(ipHash, nowMs, limits), { allowed: true });
  assert.deepEqual(await store.reserveRequest(ipHash, nowMs, limits), { allowed: false, reason: 'RATE_LIMITED' });
  assert.deepEqual(await store.reserveRequest(ipHash, nowMs, limits), { allowed: false, reason: 'DAILY_BUDGET_EXCEEDED' });

  assert.equal(captured.length, 3);
  for (const request of captured) {
    assert.equal(request.url, `${projectUrl}/rest/v1/rpc/reserve_agent_usage`);
    assert.equal(request.init.method, 'POST');
    const headers = new Headers(request.init.headers);
    assert.equal(headers.get('apikey'), secretKey);
    assert.equal(headers.has('authorization'), false);
    assert.equal(headers.get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(String(request.init.body)), {
      p_ip_hash: ipHash,
      p_minute_start: '2026-03-14T15:09:00.000Z',
      p_daily_start: '2026-03-14T00:00:00.000Z',
      p_rate_limit: 6,
      p_daily_limit: 100,
    });
  }
});
