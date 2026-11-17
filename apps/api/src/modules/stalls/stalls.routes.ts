import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { StallsService } from './stalls.service.js';

const availabilitySchema = z.object({
  state: z.enum(['open', 'paused', 'closed']),
  reason: z.enum(['hours', 'override', 'paused', 'inactive']),
  closesAt: z.date().nullable(),
  nextOpensAt: z.date().nullable(),
});

export const publicStallSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  photoUrl: z.string().nullable(),
  cuisineTags: z.array(z.string()),
  isVegOnly: z.boolean(),
  availability: availabilitySchema,
  congestion: z.object({ level: z.enum(['low', 'moderate', 'busy']), waitMinutes: z.number().int() }),
  payments: z.object({ upi: z.boolean(), cash: z.boolean() }),
  startingPricePaise: z.number().int().nullable(),
  /** Available dish names, so clients can search by dish. */
  dishes: z.array(z.string()),
});

const hoursSchema = z.object({ weekday: z.number().int(), opensAt: z.string(), closesAt: z.string() });

const slugParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Not a valid stall name')
    .max(80),
});

const menuItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  pricePaise: z.number().int(),
  isVeg: z.boolean(),
  imageUrl: z.string().nullable(),
  /** false = sold out: shown, but can't be ordered. */
  available: z.boolean(),
});

/** Public (no sign-in): GET /v1/stalls and /v1/stalls/:slug. */
export const stallsRoutes: FastifyPluginAsyncZod<{ stalls: StallsService }> = async (app, { stalls }) => {
  // A CDN (CloudFront) may reuse the answer for 15 s (s-maxage), but browsers must always ask
  // again (max-age=0): the list is polled for live wait times, and a browser-cached copy
  // would show an out-of-date busy meter.
  app.addHook('onSend', async (_req, reply) => {
    if (reply.statusCode === 200) reply.header('cache-control', 'public, max-age=0, s-maxage=15');
  });

  app.get(
    '/',
    {
      schema: {
        tags: ['stalls'],
        summary: 'All stalls with open/closed status, how busy they are and payment methods',
        response: { 200: z.object({ stalls: z.array(publicStallSchema) }) },
      },
    },
    async () => ({ stalls: await stalls.list() }),
  );

  app.get(
    '/:slug',
    {
      schema: {
        tags: ['stalls'],
        summary: 'One stall, with its weekly opening hours',
        params: slugParams,
        response: { 200: z.object({ stall: publicStallSchema.extend({ hours: z.array(hoursSchema) }) }) },
      },
    },
    async (req) => ({ stall: await stalls.getBySlug(req.params.slug) }),
  );

  app.get(
    '/:slug/menu',
    {
      schema: {
        tags: ['stalls'],
        summary: "A stall's menu: categories with dishes (sold-out dishes flagged)",
        params: slugParams,
        response: {
          200: z.object({
            stall: publicStallSchema.extend({ hours: z.array(hoursSchema) }),
            categories: z.array(z.object({ id: z.uuid(), name: z.string(), items: z.array(menuItemSchema) })),
          }),
        },
      },
    },
    async (req) => stalls.menu(req.params.slug),
  );
};
