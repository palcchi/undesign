import type { IncomingMessage, ServerResponse } from 'node:http';
import { hasExactSameOrigin, sendError, sendJson, type Environment } from './_lib/http.js';
import { isDurableQuotaConfigured, relayConfigurationReady, sessionSecret, createSession, setSessionCookie } from './_lib/security.js';
import { createSupabaseUsageStore } from './_lib/supabase-usage-store.js';

export function createSessionHandler(env: Environment = process.env) {
  const durableQuota = Boolean(createSupabaseUsageStore(env));
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'POST') {
      sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Use POST for this endpoint.');
      return;
    }
    if (!relayConfigurationReady(env, durableQuota && isDurableQuotaConfigured(env))) {
      sendError(res, 503, 'RELAY_NOT_READY', 'The relay is not securely configured.');
      return;
    }
    if (!hasExactSameOrigin(req, env)) {
      sendError(res, 403, 'ORIGIN_DENIED', 'Origin is not allowed.');
      return;
    }
    const secret = sessionSecret(env);
    if (!secret) {
      sendError(res, 503, 'RELAY_NOT_READY', 'The relay is not securely configured.');
      return;
    }
    const issued = createSession(secret);
    res.setHeader('Set-Cookie', setSessionCookie(env, issued.cookieValue));
    sendJson(res, 200, { csrfToken: issued.csrfToken, expiresAt: issued.expiresAt });
  };
}

export default createSessionHandler();
