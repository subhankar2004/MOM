import { normalizeIndianMobile } from '@mom/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { AuthService } from './auth.service.js';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies, type CookieConfig } from './cookies.js';

export interface AuthRoutesOptions {
  auth: AuthService;
  cookies: CookieConfig;
  /** Login-code requests per IP per minute (verify allows twice as many). */
  ratePerMinute?: number;
}

const phoneField = z
  .string()
  .max(20)
  .transform((v, ctx) => {
    const e164 = normalizeIndianMobile(v);
    if (!e164) {
      ctx.addIssue({ code: 'custom', message: 'Enter a 10-digit Indian mobile number' });
      return z.NEVER;
    }
    return e164;
  })
  .describe('Indian mobile number, e.g. "98765 43210" or "+919876543210"');

export const publicUser = z.object({
  id: z.uuid(),
  phone: z.string(),
  name: z.string().nullable(),
  role: z.enum(['student', 'vendor_owner', 'vendor_staff', 'super_admin']),
});

const sessionResponse = z.object({
  user: publicUser,
  /** True when the user still has to enter their name (first login). */
  isNewUser: z.boolean().optional(),
  accessTokenExpiresAt: z.iso.datetime(),
});

/** POST /v1/auth/... — phone OTP login, token refresh and logout. */
export const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (
  app,
  { auth, cookies, ratePerMinute = 10 },
) => {
  const meta = (req: { ip: string; headers: { 'user-agent'?: string } }) => ({
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  app.post(
    '/otp/request',
    {
      // Per-IP burst limit on top of the per-phone/per-IP hourly limits in AuthService.
      config: { rateLimit: { max: ratePerMinute, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Send a login code by SMS',
        body: z.object({ phone: phoneField }),
        response: {
          202: z.object({ expiresInSeconds: z.number().int(), resendAfterSeconds: z.number().int() }),
        },
      },
    },
    async (req, reply) => reply.status(202).send(await auth.requestOtp(req.body.phone, meta(req))),
  );

  app.post(
    '/otp/verify',
    {
      config: { rateLimit: { max: ratePerMinute * 2, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Check the code and sign in (sets session cookies)',
        body: z.object({
          phone: phoneField,
          code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
          /** Which sign-in page: student (default, anyone), vendor (stall accounts), admin. */
          portal: z.enum(['student', 'vendor', 'admin']).default('student'),
        }),
        response: { 200: sessionResponse },
      },
    },
    async (req, reply) => {
      const { session, isNewUser } = await auth.verifyOtp(
        req.body.phone,
        req.body.code,
        meta(req),
        req.body.portal,
      );
      setAuthCookies(reply, cookies, session);
      return {
        user: session.user,
        isNewUser,
        accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
      };
    },
  );

  app.post(
    '/refresh',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Rotate the session (uses the refresh cookie)',
        response: { 200: sessionResponse },
      },
    },
    async (req, reply) => {
      const raw = req.cookies[REFRESH_COOKIE];
      try {
        if (!raw) throw new AppError(401, 'SESSION_EXPIRED', 'Please sign in.');
        const session = await auth.refresh(raw, meta(req));
        setAuthCookies(reply, cookies, session);
        return { user: session.user, accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString() };
      } catch (err) {
        clearAuthCookies(reply, cookies); // a failed refresh always signs the browser out
        throw err;
      }
    },
  );

  app.post(
    '/logout',
    { schema: { tags: ['auth'], summary: 'Sign out on this device', response: { 204: z.null() } } },
    async (req, reply) => {
      await auth.logout(req.cookies[REFRESH_COOKIE]);
      clearAuthCookies(reply, cookies);
      return reply.status(204).send(null);
    },
  );
};
