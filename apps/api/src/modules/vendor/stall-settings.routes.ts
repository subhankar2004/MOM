import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireRole, requireStallAccess } from '../../plugins/authz.js';
import type { Actor, StallSettingsService } from './stall-settings.service.js';

const params = z.object({ stallId: z.uuid('Not a valid stall id') });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM times');

const slot = z.object({
  weekday: z.number().int().min(1).max(7),
  opensAt: time,
  closesAt: time,
});

const settingsResponse = z.object({
  settings: z.object({
    name: z.string(),
    status: z.enum(['draft', 'active', 'suspended']),
    description: z.string().nullable(),
    location: z.string().nullable(),
    photoKey: z.string().nullable(),
    photoUrl: z.string().nullable(),
    isOpenOverride: z.boolean().nullable(),
    acceptingOrders: z.boolean(),
    avgPrepMinutes: z.number().int(),
    parallelCapacity: z.number().int(),
    upiEnabled: z.boolean(),
    cashEnabled: z.boolean(),
    routeStatus: z.enum(['not_started', 'pending', 'activated', 'rejected', 'suspended']),
    payments: z.object({ upi: z.boolean(), cash: z.boolean() }),
  }),
  hours: z.array(slot),
  availability: z.object({
    state: z.enum(['open', 'paused', 'closed']),
    reason: z.enum(['hours', 'override', 'paused', 'inactive']),
    closesAt: z.date().nullable(),
    nextOpensAt: z.date().nullable(),
  }),
});

export interface StallSettingsRoutesOptions {
  settings: StallSettingsService;
  /** Called after any change, so the public stall list shows it at once. */
  onChange: () => void;
  now?: () => Date;
}

function actor(req: FastifyRequest): Actor {
  const ua = req.headers['user-agent'];
  return { userId: req.auth!.userId, ip: req.ip, userAgent: typeof ua === 'string' ? ua : undefined };
}

/**
 * /v1/vendor/stalls/:stallId/{settings,hours} — open/close, pause, hours, kitchen speed,
 * profile and payment methods (spec §6.2 V6, V7). Owners and super admins only.
 */
export const stallSettingsRoutes: FastifyPluginAsyncZod<StallSettingsRoutesOptions> = async (app, opts) => {
  const now = opts.now ?? (() => new Date());
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', requireRole('vendor_owner', 'super_admin'));
  app.addHook('preHandler', requireStallAccess(app.db, { memberRoles: ['owner'] }));

  app.get(
    '/stalls/:stallId/settings',
    {
      schema: {
        tags: ['vendor'],
        summary: "The stall's settings, weekly hours and whether it's open right now",
        params,
        response: { 200: settingsResponse },
      },
    },
    async (req) => opts.settings.get(req.params.stallId, now()),
  );

  app.patch(
    '/stalls/:stallId/settings',
    {
      schema: {
        tags: ['vendor'],
        summary:
          'Change settings: open/close now (null = follow hours), pause, prep time, capacity, profile, payment methods',
        params,
        body: z
          .object({
            isOpenOverride: z.boolean().nullable(),
            acceptingOrders: z.boolean(),
            avgPrepMinutes: z.number().int().min(1, 'At least 1 minute').max(120, 'At most 120 minutes'),
            parallelCapacity: z.number().int().min(1, 'At least 1').max(50, 'At most 50'),
            description: z.string().trim().max(300, 'Keep the description under 300 characters').nullable(),
            location: z.string().trim().max(120, 'Keep the location under 120 characters').nullable(),
            photoKey: z.string().max(200).nullable(),
            upiEnabled: z.boolean(),
            cashEnabled: z.boolean(),
          })
          .partial(),
        response: { 200: settingsResponse },
      },
    },
    async (req) => {
      const result = await opts.settings.update(req.params.stallId, req.body, actor(req), now());
      opts.onChange();
      return result;
    },
  );

  app.put(
    '/stalls/:stallId/hours',
    {
      schema: {
        tags: ['vendor'],
        summary: 'Replace the weekly opening hours (several slots a day; overnight slots allowed)',
        params,
        body: z.object({ slots: z.array(slot).max(35, 'At most 5 slots a day') }),
        response: { 200: settingsResponse },
      },
    },
    async (req) => {
      const result = await opts.settings.replaceHours(req.params.stallId, req.body.slots, actor(req), now());
      opts.onChange();
      return result;
    },
  );
};
