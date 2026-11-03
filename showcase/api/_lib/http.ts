import type { IncomingMessage, ServerResponse } from 'node:http';

export type Environment = NodeJS.ProcessEnv;

export function requestHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.origin === origin
      && (url.protocol === 'http:' || url.protocol === 'https:')
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  } catch {
    return false;
  }
}

export function configuredPublicOrigin(env: Environment): string | undefined {
  const value = env.PUBLIC_ORIGIN?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const secureProduction = env.NODE_ENV === 'production';
    const devLoopback = !secureProduction && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
    if (url.origin !== value || (url.protocol !== 'https:' && !(url.protocol === 'http:' && devLoopback)) || url.username || url.password) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

/** Require a literal Origin header equal to the canonical public origin. Development can use loopback only. */
export function hasExactSameOrigin(req: IncomingMessage, env: Environment): boolean {
  const origin = requestHeader(req, 'origin');
  if (!origin || origin === 'null') return false;
  const configured = configuredPublicOrigin(env);
  if (env.NODE_ENV === 'production') return Boolean(configured && origin === configured);
  if (env.PUBLIC_ORIGIN?.trim()) return Boolean(configured && origin === configured);
  if (!isLoopbackOrigin(origin)) return false;
  const host = requestHeader(req, 'host');
  if (!host) return false;
  const scheme = (req.socket as import('node:tls').TLSSocket).encrypted ? 'https:' : 'http:';
  try {
    const expected = new URL(`${scheme}//${host}`);
    return expected.origin === origin && isLoopbackOrigin(expected.origin);
  } catch {
    return false;
  }
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

export function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}
