import { normalizeIndianMobile } from '@mom/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireSuperAdmin } from '../../plugins/authz.js';
import type { StallsAdminService } from './stalls-admin.service.js';

const stallParams = z.object({ stallId: z.uuid('Not a valid stall id') });
const status = z.enum(['draft', 'active', 'suspended']);
const routeStatus = z.enum(['not_started', 'pending', 'activated', 'rejected', 'suspended']);
const checklist = z.object({
  menu: z.boolean(),
  hours: z.boolean(),
  photo: z.boolean(),
  payments: z.boolean(),
  owner: z.boolean(),
});

const details = {
  name: z.string().trim().min(2, 'At least 2 characters').max(60, 'At most 60 characters'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes'),
  description: z.string().trim().max(300).nullable(),
  location: z.string().trim().max(120).nullable(),
  cuisineTags: z.array(z.string().trim().min(1).max(20)).max(6, 'At most 6 tags'),
  isVegOnly: z.boolean(),
};

const stallDetail = z.object({
  stall: z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    location: z.string().nullable(),
    cuisineTags: z.array(z.string()),
    isVegOnly: z.boolean(),
    status,
    photoUrl: z.string().nullable(),
    upiEnabled: z.boolean(),
    cashEnabled: z.boolean(),
    routeStatus,
    razorpayAccountId: z.string().nullable(),
    createdAt: z.date(),
  }),
  checklist,
  members: z.array(
    z.object({
      userId: z.uuid(),
      name: z.string().nullable(),
      phone: z.string().nullable(),
      role: z.enum(['owner', 'staff']),
    }),
  ),
  pending: z.array(z.object({ phone: z.string(), role: z.enum(['owner', 'staff']), invitedAt: z.date() })),
  canTestActivate: z.boolean(),
});

const mobile10 = z.string().transform((v, ctx) => {
  const e164 = normalizeIndianMobile(v);
  if (!e164) {
    ctx.addIssue({ code: 'custom', message: 'Enter a 10-digit Indian mobile number' });
    return z.NEVER;
  }
  return e164.slice(3); // Razorpay wants the 10 digits
});

/** /v1/admin/stalls — stalls & onboarding (spec §6.3 A3). Super admin only; everything audited. */
export const adminStallsRoutes: FastifyPluginAsyncZod<{ stalls: StallsAdminService }> = async (app, opts) => {
  const { stalls } = opts;
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', requireSuperAdmin(app.db));
  const actor = (req: {
    auth: { userId: string } | null;
    ip: string;
    headers: { 'user-agent'?: string };
  }) => ({
    actorId: req.auth!.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  app.get(
    '/stalls',
    {
      schema: {
        tags: ['admin'],
        summary: 'All stalls with their go-live checklist (search by name or web address)',
        querystring: z.object({ q: z.string().max(60).optional(), status: status.optional() }),
        response: {
          200: z.object({
            stalls: z.array(
              z.object({
                id: z.uuid(),
                slug: z.string(),
                name: z.string(),
                location: z.string().nullable(),
                status,
                routeStatus,
                createdAt: z.date(),
                checklist,
              }),
            ),
          }),
        },
      },
    },
    async (req) => ({ stalls: await stalls.list(req.query) }),
  );

  app.post(
    '/stalls',
    {
      schema: {
        tags: ['admin'],
        summary: 'Create a stall (as a draft, hidden from students until it goes live)',
        body: z.object({
          name: details.name,
          slug: details.slug.optional(),
          description: details.description.optional(),
          location: details.location.optional(),
          cuisineTags: details.cuisineTags.optional(),
          isVegOnly: details.isVegOnly.optional(),
        }),
        response: { 201: z.object({ id: z.uuid(), slug: z.string() }) },
      },
    },
    async (req, reply) => reply.status(201).send(await stalls.create(req.body, actor(req))),
  );

  app.get(
    '/stalls/:stallId',
    {
      schema: {
        tags: ['admin'],
        summary: 'One stall: details, checklist, owners and staff, settlement account',
        params: stallParams,
        response: { 200: stallDetail },
      },
    },
    async (req) => stalls.get(req.params.stallId),
  );

  app.patch(
    '/stalls/:stallId',
    {
      schema: {
        tags: ['admin'],
        summary: 'Edit a stall, or change its status (going live needs the whole checklist)',
        params: stallParams,
        body: z.object({ ...details, status }).partial(),
        response: { 200: stallDetail },
      },
    },
    async (req) => stalls.update(req.params.stallId, req.body, actor(req)),
  );

  app.post(
    '/stalls/:stallId/settlement-account',
    {
      // Don't let a broken form hammer Razorpay.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['admin'],
        summary:
          "Set up the stall's Razorpay Route linked account (resumes a half-finished setup). Bank details go to Razorpay only",
        params: stallParams,
        body: z.object({
          account: z.object({
            email: z.email('Enter a valid email'),
            phone: mobile10,
            legalBusinessName: z.string().trim().min(4).max(200),
            businessType: z.enum(['individual', 'proprietorship']),
            contactName: z.string().trim().min(2).max(120),
            address: z.object({
              street1: z.string().trim().min(3).max(100),
              street2: z.string().trim().max(100).optional(),
              city: z.string().trim().min(2).max(100),
              state: z.string().trim().min(2).max(32),
              postalCode: z.string().regex(/^\d{6}$/, 'PIN code is 6 digits'),
            }),
          }),
          bank: z.object({
            accountNumber: z
              .string()
              .trim()
              .regex(/^[A-Za-z0-9]{5,20}$/, 'Account number is 5–20 letters or digits'),
            ifsc: z
              .string()
              .trim()
              .toUpperCase()
              .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC looks like SBIN0001234'),
            beneficiaryName: z.string().trim().min(2).max(120),
          }),
        }),
        response: { 200: stallDetail },
      },
    },
    async (req) => stalls.setUpSettlementAccount(req.params.stallId, req.body, actor(req)),
  );

  app.post(
    '/stalls/:stallId/settlement-account/refresh',
    {
      schema: {
        tags: ['admin'],
        summary: 'Check with Razorpay whether the settlement account is active',
        params: stallParams,
        response: { 200: stallDetail.extend({ requirements: z.array(z.string()) }) },
      },
    },
    async (req) => stalls.refreshSettlementAccount(req.params.stallId, actor(req)),
  );

  app.post(
    '/stalls/:stallId/settlement-account/test-activate',
    {
      schema: {
        tags: ['admin'],
        summary: 'Test keys only: mark the settlement account active so UPI can be tried',
        params: stallParams,
        response: { 200: stallDetail },
      },
    },
    async (req) => stalls.testActivate(req.params.stallId, actor(req)),
  );
};
