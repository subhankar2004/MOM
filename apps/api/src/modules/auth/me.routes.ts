import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { publicUser, type AuthRoutesOptions } from './auth.routes.js';
import { clearAuthCookies } from './cookies.js';

/** GET/PATCH/DELETE /v1/me — the signed-in user's own account. */
export const meRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (app, { auth, cookies }) => {
  app.addHook('preHandler', app.requireAuth);

  app.get(
    '/',
    { schema: { tags: ['me'], summary: 'Who am I', response: { 200: z.object({ user: publicUser }) } } },
    async (req) => ({ user: await auth.getUser(req.auth!.userId) }),
  );

  app.patch(
    '/',
    {
      schema: {
        tags: ['me'],
        summary: 'Update my name',
        body: z.object({
          name: z
            .string()
            .trim()
            .min(1, 'Enter your name')
            .max(60, 'Use at most 60 characters')
            .regex(/^[\p{L}\p{M} .'-]+$/u, 'Use letters, spaces, dots, apostrophes or hyphens'),
        }),
        response: { 200: z.object({ user: publicUser }) },
      },
    },
    async (req) => ({ user: await auth.updateName(req.auth!.userId, req.body.name) }),
  );

  app.delete(
    '/',
    {
      schema: {
        tags: ['me'],
        summary: 'Delete my account (personal data is erased)',
        body: z.object({ confirm: z.literal(true, 'Confirm by sending {"confirm": true}') }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      await auth.deleteAccount(req.auth!.userId);
      clearAuthCookies(reply, cookies);
      return reply.status(204).send(null);
    },
  );
};
