import { createHmac, randomBytes } from 'node:crypto';
import type { Environment } from './http.js';

export type QuotaReason = 'RATE_LIMITED' | 'DAILY_BUDGET_EXCEEDED';
export type QuotaDecision = { allowed: true } | { allowed: false; reason: QuotaReason };

export interface UsageLimits {
  perIpPerMinute: number;
  globalPerDay: number;
}

export interface UsageStore {
  reserveRequest(ipHash: string, nowMs: number, limits: UsageLimits): Promise<QuotaDecision>;
}

export class InMemoryUsageStore implements UsageStore {
  private readonly perIpMinute = new Map<string, number>();
  private dailyCount = 0;
  private dailyWindow = -1;
  private lastCleanupMinute = -1;

  async reserveRequest(ipHash: string, nowMs: number, limits: UsageLimits): Promise<QuotaDecision> {
    const minute = Math.floor(nowMs / 60_000);
    const day = Math.floor(nowMs / 86_400_000);
    const ipWindow = `${ipHash}:${minute}`;

    if (day !== this.dailyWindow) {
      this.dailyWindow = day;
      this.dailyCount = 0;
    }
    if (minute !== this.lastCleanupMinute && minute % 5 === 0) {
      for (const key of this.perIpMinute.keys()) {
        const keyMinute = Number(key.slice(key.lastIndexOf(':') + 1));
        if (keyMinute < minute) this.perIpMinute.delete(key);
      }
      this.lastCleanupMinute = minute;
    }

    const ipCount = this.perIpMinute.get(ipWindow) ?? 0;
    if (ipCount >= limits.perIpPerMinute) return { allowed: false, reason: 'RATE_LIMITED' };
    if (this.dailyCount >= limits.globalPerDay) return { allowed: false, reason: 'DAILY_BUDGET_EXCEEDED' };

    this.perIpMinute.set(ipWindow, ipCount + 1);
    this.dailyCount += 1;
    return { allowed: true };
  }
}

let developmentIpHashSecret: string | undefined;

export function createIpHasher(env: Environment): (ip: string) => string {
  let secret = env.IP_HASH_SECRET?.trim();
  if (!secret && env.NODE_ENV !== 'production') {
    developmentIpHashSecret ??= randomBytes(32).toString('base64url');
    secret = developmentIpHashSecret;
  }
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) throw new Error('IP hash configuration is unavailable');
  return (ip: string) => createHmac('sha256', secret!).update(ip).digest('hex');
}

export function createMemoryUsageStore(): UsageStore {
  return new InMemoryUsageStore();
}
