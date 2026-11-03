import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendError, sendJson, type Environment } from './_lib/http.js';
import { isDurableQuotaConfigured, readiness } from './_lib/security.js';

export function createHealthHandler(env: Environment = process.env) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') {
      sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
      return;
    }
    const state = readiness(env, isDurableQuotaConfigured(env));
    const ok = Object.values(state).every(Boolean);
    sendJson(res, ok ? 200 : 503, { ok, ...state });
  };
}

const handler = createHealthHandler();
export default handler;
