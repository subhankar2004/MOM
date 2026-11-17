import type { FastifyReply } from 'fastify';

export const ACCESS_COOKIE = 'mom_at';
export const REFRESH_COOKIE = 'mom_rt';
/** The refresh token is only ever sent to the auth endpoints, never with normal API calls. */
export const REFRESH_COOKIE_PATH = '/v1/auth';

export interface CookieConfig {
  secure: boolean;
  domain?: string;
}

/**
 * Both cookies are httpOnly (JavaScript can't read them, so XSS can't steal them) and
 * SameSite=Lax (not sent on cross-site POSTs — the first CSRF defence; the Origin check is the second).
 */
export function setAuthCookies(
  reply: FastifyReply,
  cfg: CookieConfig,
  session: {
    accessToken: string;
    accessTokenExpiresAt: Date;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
  },
): void {
  const base = { httpOnly: true, secure: cfg.secure, sameSite: 'lax' as const, domain: cfg.domain };
  reply.setCookie(ACCESS_COOKIE, session.accessToken, {
    ...base,
    path: '/',
    expires: session.accessTokenExpiresAt,
  });
  reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    expires: session.refreshTokenExpiresAt,
  });
}

export function clearAuthCookies(reply: FastifyReply, cfg: CookieConfig): void {
  const base = { httpOnly: true, secure: cfg.secure, sameSite: 'lax' as const, domain: cfg.domain };
  reply.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  reply.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_COOKIE_PATH });
}
