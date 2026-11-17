import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, unauthenticated } from '../lib/errors.js';
import { ACCESS_COOKIE } from '../modules/auth/cookies.js';
import { verifyAccessToken, type AccessClaims } from '../modules/auth/tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by requireAuth for signed-in requests. */
    auth: AccessClaims | null;
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * - `request.auth` + `requireAuth`: reads the access token from the httpOnly cookie
 *   (web) or an `Authorization: Bearer` header (mobile app, later).
 * - CSRF defence #2: state-changing requests from a browser must come from WEB_ORIGIN.
 */
export function registerAuth(
  app: FastifyInstance,
  opts: { jwtSecret: string; allowedOrigins: string[] },
): void {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (request) => {
    if (!UNSAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    const site = request.headers['sec-fetch-site'];
    const crossSiteWithoutOrigin = !origin && site === 'cross-site';
    if ((origin && !opts.allowedOrigins.includes(origin)) || crossSiteWithoutOrigin) {
      request.log.warn({ origin, site }, 'blocked cross-site state-changing request');
      throw new AppError(403, 'FORBIDDEN', 'This request was blocked because it came from another website.');
    }
  });

  app.decorate('requireAuth', async (request: FastifyRequest, _reply: FastifyReply) => {
    const header = request.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const token = request.cookies[ACCESS_COOKIE] ?? bearer;
    if (!token) throw unauthenticated();
    const result = await verifyAccessToken(opts.jwtSecret, token);
    if (!result.ok) {
      // Expired → the web app silently calls /v1/auth/refresh and retries (#8).
      throw unauthenticated(result.reason === 'expired' ? 'Your session needs refreshing' : 'Please sign in');
    }
    request.auth = result.claims;
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler: 401 unless the request carries a valid access token. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
