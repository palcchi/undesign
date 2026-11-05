import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { configuredPublicOrigin, hasExactSameOrigin, requestHeader, type Environment } from './http.js';

export const SESSION_COOKIE = 'undesign_session';
export const SESSION_TTL_SECONDS = 60 * 60;
export const CSRF_TTL_SECONDS = 10 * 60;
const COOKIE_MAX_AGE = SESSION_TTL_SECONDS;
const MIN_SECRET_BYTES = 32;

export interface SessionClaims {
  sid: string;
  exp: number;
}

export interface Readiness {
  sessionReady: boolean;
  originReady: boolean;
  hashReady: boolean;
  quotaReady: boolean;
  upstreamReady: boolean;
}

let developmentSecret: string | undefined;

function production(env: Environment): boolean {
  return env.NODE_ENV === 'production';
}

function strongSecret(value: string | undefined): value is string {
  return Boolean(value && Buffer.byteLength(value, 'utf8') >= MIN_SECRET_BYTES);
}

export function sessionSecret(env: Environment): string | undefined {
  if (strongSecret(env.SESSION_SECRET)) return env.SESSION_SECRET;
  if (production(env)) return undefined;
  // Development-only process secret; production never generates a volatile signing key.
  developmentSecret ??= randomBytes(32).toString('base64url');
  return developmentSecret;
}

export function isDurableQuotaConfigured(env: Environment): boolean {
  const url = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secretKey?.startsWith('sb_secret_')) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.origin === url.replace(/\/$/, '')
      && parsed.hostname.endsWith('.supabase.co');
  } catch {
    return false;
  }
}

export function readiness(env: Environment, durableQuotaAvailable = isDurableQuotaConfigured(env)): Readiness {
  const prod = production(env);
  const secret = sessionSecret(env);
  const origin = configuredPublicOrigin(env);
  const hashSecret = env.IP_HASH_SECRET?.trim();
  const providerKey = env.META_API_KEY?.trim();
  return {
    sessionReady: Boolean(secret && (!prod || strongSecret(env.SESSION_SECRET))),
    originReady: Boolean(origin && (!prod || origin.startsWith('https://')))
      || (!prod && !env.PUBLIC_ORIGIN?.trim()),
    hashReady: prod
      ? Boolean(hashSecret && Buffer.byteLength(hashSecret, 'utf8') >= MIN_SECRET_BYTES
        && hashSecret !== env.SESSION_SECRET?.trim())
      : (!hashSecret || (Buffer.byteLength(hashSecret, 'utf8') >= MIN_SECRET_BYTES
        && hashSecret !== env.SESSION_SECRET?.trim())),
    quotaReady: prod ? durableQuotaAvailable : true,
    upstreamReady: Boolean(providerKey && providerKey.length <= 4_096 && !/\s/.test(providerKey)),
  };
}

export function relayConfigurationReady(env: Environment, durableQuotaAvailable = isDurableQuotaConfigured(env)): boolean {
  const state = readiness(env, durableQuotaAvailable);
  return Object.values(state).every(Boolean);
}

function mac(secret: string, purpose: string, value: string): Buffer {
  return createHmac('sha256', secret).update(`${purpose}\0${value}`).digest();
}

function equalMac(actual: string, expected: Buffer): boolean {
  let supplied: Buffer;
  try {
    supplied = Buffer.from(actual, 'base64url');
  } catch {
    return false;
  }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createSession(secret: string, nowMs = Date.now()): { cookieValue: string; csrfToken: string; expiresAt: number } {
  const nowSeconds = Math.floor(nowMs / 1_000);
  const claims: SessionClaims = { sid: randomBytes(32).toString('base64url'), exp: nowSeconds + SESSION_TTL_SECONDS };
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const cookieValue = `${encoded}.${mac(secret, 'session', encoded).toString('base64url')}`;
  const csrfExp = nowSeconds + CSRF_TTL_SECONDS;
  const csrfBody = `${claims.sid}.${csrfExp}`;
  const csrfToken = `${csrfExp}.${mac(secret, 'csrf', csrfBody).toString('base64url')}`;
  return { cookieValue, csrfToken, expiresAt: claims.exp * 1_000 };
}

export function verifySession(cookieValue: string | undefined, secret: string, nowMs = Date.now()): SessionClaims | undefined {
  if (!cookieValue || cookieValue.length > 2_048) return undefined;
  const split = cookieValue.split('.');
  if (split.length !== 2 || !split[0] || !equalMac(split[1]!, mac(secret, 'session', split[0]!))) return undefined;
  try {
    const claims: unknown = JSON.parse(Buffer.from(split[0]!, 'base64url').toString('utf8'));
    if (typeof claims !== 'object' || claims === null) return undefined;
    const candidate = claims as Partial<SessionClaims>;
    const nowSeconds = Math.floor(nowMs / 1_000);
    if (typeof candidate.sid !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(candidate.sid)
      || typeof candidate.exp !== 'number' || !Number.isSafeInteger(candidate.exp)
      || candidate.exp <= nowSeconds || candidate.exp > nowSeconds + SESSION_TTL_SECONDS + 5) return undefined;
    return { sid: candidate.sid, exp: candidate.exp };
  } catch {
    return undefined;
  }
}

export function verifyCsrf(token: string | undefined, claims: SessionClaims, secret: string, nowMs = Date.now()): boolean {
  if (!token || token.length > 256) return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]!)) return false;
  const exp = Number(parts[0]);
  const nowSeconds = Math.floor(nowMs / 1_000);
  if (!Number.isSafeInteger(exp) || exp <= nowSeconds || exp > nowSeconds + CSRF_TTL_SECONDS + 5) return false;
  return equalMac(parts[1]!, mac(secret, 'csrf', `${claims.sid}.${exp}`));
}

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  const raw = requestHeader(req, 'cookie');
  if (!raw || raw.length > 8_192) return undefined;
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return undefined;
}

export function setSessionCookie(env: Environment, cookieValue: string): string {
  const secure = production(env) ? '; Secure' : '';
  return `${SESSION_COOKIE}=${cookieValue}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Strict${secure}`;
}

export function requestHasSessionAndCsrf(req: IncomingMessage, env: Environment, nowMs = Date.now()): boolean {
  const secret = sessionSecret(env);
  if (!secret) return false;
  const claims = verifySession(readCookie(req, SESSION_COOKIE), secret, nowMs);
  if (!claims) return false;
  return verifyCsrf(requestHeader(req, 'x-csrf-token'), claims, secret, nowMs);
}

export function requestHasOrigin(req: IncomingMessage, env: Environment): boolean {
  return hasExactSameOrigin(req, env);
}
