import type { Environment } from './http.js';
import type { QuotaDecision, UsageLimits, UsageStore } from './usage-store.js';

const MAX_QUOTA_RESPONSE_BYTES = 16_384;

export class SupabaseUsageStore implements UsageStore {
  private readonly rpcUrl: string;
  private readonly serviceRoleKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(url: string, serviceRoleKey: string, fetchImpl: typeof fetch = fetch) {
    this.rpcUrl = `${url.replace(/\/$/, '')}/rest/v1/rpc/reserve_agent_usage`;
    this.serviceRoleKey = serviceRoleKey;
    this.fetchImpl = fetchImpl;
  }

  async reserveRequest(ipHash: string, nowMs: number, limits: UsageLimits): Promise<QuotaDecision> {
    const now = new Date(nowMs);
    const minuteStart = new Date(Math.floor(nowMs / 60_000) * 60_000).toISOString();
    const dailyStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const response = await this.fetchImpl(this.rpcUrl, {
      method: 'POST',
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        p_ip_hash: ipHash,
        p_minute_start: minuteStart,
        p_daily_start: dailyStart,
        p_rate_limit: limits.perIpPerMinute,
        p_daily_limit: limits.globalPerDay,
      }),
      signal: AbortSignal.timeout(3_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('quota store unavailable');

    const data: unknown = JSON.parse(await readQuotaResponse(response));
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') throw new Error('invalid quota response');
    const result = row as { allowed?: unknown; reason?: unknown };
    if (result.allowed === true) return { allowed: true };
    if (result.allowed === false && result.reason === 'RATE_LIMITED') {
      return { allowed: false, reason: 'RATE_LIMITED' };
    }
    if (result.allowed === false && result.reason === 'DAILY_BUDGET_EXCEEDED') {
      return { allowed: false, reason: 'DAILY_BUDGET_EXCEEDED' };
    }
    throw new Error('invalid quota response');
  }
}

async function readQuotaResponse(response: Response): Promise<string> {
  if (!response.body) throw new Error('empty quota response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_QUOTA_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('quota response exceeded size limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

export function createSupabaseUsageStore(env: Environment, fetchImpl: typeof fetch = fetch): UsageStore | undefined {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.origin !== url.replace(/\/$/, '') || !parsed.hostname.endsWith('.supabase.co')) return undefined;
  } catch {
    return undefined;
  }
  return new SupabaseUsageStore(url, key, fetchImpl);
}
