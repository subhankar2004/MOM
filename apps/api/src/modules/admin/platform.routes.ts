import { aliasedTable, and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditLog, users } from '../../db/schema/index.js';
import { badRequest } from '../../lib/errors.js';
import { requireSuperAdmin } from '../../plugins/authz.js';
import { cancelScheduledSettings, saveSettings, settingsOverview } from '../settings/settings.service.js';

const settingsRow = z.object({
  id: z.number().int(),
  platformFeeBps: z.number().int(),
  cashFeeBps: z.number().int(),
  maxOpenCashOrders: z.number().int(),
  cashStrikeLimit: z.number().int(),
  orderExpiryMinutes: z.number().int(),
  congestionLowMaxMinutes: z.number().int(),
  congestionModerateMaxMinutes: z.number().int(),
  cashEnabledGlobally: z.boolean(),
  orderingPaused: z.boolean(),
  effectiveFrom: z.date(),
});
const versionRow = settingsRow.extend({ createdBy: z.string().nullable(), createdAt: z.date() });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const istStart = (day: string) => new Date(`${day}T00:00:00+05:30`);

function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** /v1/admin/settings and /v1/admin/audit (spec §6.3 A7, A8). Super admin only. */
export const adminPlatformRoutes: FastifyPluginAsyncZod<{
  now?: () => Date;
  onSettingsChange: () => void;
}> = async (app, opts) => {
  const now = opts.now ?? (() => new Date());
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
    '/settings',
    {
      schema: {
        tags: ['admin'],
        summary: 'Platform settings in force, changes scheduled for later, and recent versions',
        response: {
          200: z.object({
            current: settingsRow,
            scheduled: z.array(versionRow),
            history: z.array(versionRow),
          }),
        },
      },
    },
    async () => settingsOverview(app.db),
  );

  app.post(
    '/settings',
    {
      schema: {
        tags: ['admin'],
        summary:
          'Save new platform settings (a new version; fees apply to orders placed after effectiveFrom, default now). Audited',
        body: z.object({
          platformFeeBps: z.number().int().min(0).max(2000, 'At most 20%'),
          cashFeeBps: z.number().int().min(0).max(2000, 'At most 20%'),
          maxOpenCashOrders: z.number().int().min(0).max(20),
          cashStrikeLimit: z.number().int().min(1).max(20),
          orderExpiryMinutes: z.number().int().min(5).max(60),
          congestionLowMaxMinutes: z.number().int().min(1).max(240),
          congestionModerateMaxMinutes: z.number().int().min(2).max(240),
          cashEnabledGlobally: z.boolean(),
          orderingPaused: z.boolean(),
          effectiveFrom: z.coerce.date().optional(),
        }),
        response: { 201: z.object({ settings: settingsRow }) },
      },
    },
    async (req, reply) => {
      const row = await saveSettings(app.db, req.body, actor(req), now());
      opts.onSettingsChange();
      return reply.status(201).send({ settings: row });
    },
  );

  app.delete(
    '/settings/:id',
    {
      schema: {
        tags: ['admin'],
        summary: 'Cancel a scheduled settings change (only before it takes effect). Audited',
        params: z.object({ id: z.coerce.number().int().positive() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      await cancelScheduledSettings(app.db, req.params.id, actor(req));
      return reply.status(204).send(null);
    },
  );

  const who = aliasedTable(users, 'who');
  app.get(
    '/audit',
    {
      schema: {
        tags: ['admin'],
        summary:
          'Audit log (read-only): filter by who (name or phone), entity, a record id, action and India dates; newest first',
        querystring: z.object({
          actor: z.string().max(60).optional(),
          actorId: z.uuid().optional(),
          entity: z.string().max(40).optional(),
          entityId: z.string().max(80).optional(),
          action: z.string().max(60).optional(),
          from: date.optional(),
          to: date.optional(),
          before: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: {
          200: z.object({
            entries: z.array(
              z.object({
                id: z.number().int(),
                createdAt: z.date(),
                actor: z
                  .object({ id: z.string(), name: z.string().nullable(), phone: z.string().nullable() })
                  .nullable(),
                action: z.string(),
                entity: z.string(),
                entityId: z.string().nullable(),
                before: z.unknown(),
                after: z.unknown(),
                ip: z.string().nullable(),
                userAgent: z.string().nullable(),
              }),
            ),
            nextBefore: z.number().int().nullable(),
          }),
        },
      },
    },
    async (req) => {
      const q = req.query;
      if (q.from && q.to && q.from > q.to) throw badRequest('"from" must be on or before "to"');
      const digits = q.actor?.replace(/\D/g, '') ?? '';
      const rows = await app.db
        .select({
          id: auditLog.id,
          createdAt: auditLog.createdAt,
          actorId: auditLog.actorId,
          actorName: who.name,
          actorPhone: who.phone,
          action: auditLog.action,
          entity: auditLog.entity,
          entityId: auditLog.entityId,
          before: auditLog.before,
          after: auditLog.after,
          ip: auditLog.ip,
          userAgent: auditLog.userAgent,
        })
        .from(auditLog)
        .leftJoin(who, eq(who.id, auditLog.actorId))
        .where(
          and(
            q.actorId ? eq(auditLog.actorId, q.actorId) : undefined,
            q.actor?.trim()
              ? q.actor.trim().toLowerCase() === 'system'
                ? sql`${auditLog.actorId} is null`
                : or(
                    ilike(who.name, `%${escapeLike(q.actor.trim())}%`),
                    digits.length >= 4 ? ilike(who.phone, `%${escapeLike(digits.slice(-10))}%`) : undefined,
                  )
              : undefined,
            q.entity ? eq(auditLog.entity, q.entity) : undefined,
            q.entityId ? eq(auditLog.entityId, q.entityId) : undefined,
            q.action ? ilike(auditLog.action, `${escapeLike(q.action)}%`) : undefined,
            q.from ? sql`${auditLog.createdAt} >= ${istStart(q.from)}` : undefined,
            q.to
              ? sql`${auditLog.createdAt} < ${new Date(istStart(q.to).getTime() + 86_400_000)}`
              : undefined,
            q.before ? sql`${auditLog.id} < ${q.before}` : undefined,
          ),
        )
        .orderBy(desc(auditLog.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      return {
        entries: page.map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          actor: r.actorId ? { id: r.actorId, name: r.actorName, phone: r.actorPhone } : null,
          action: r.action,
          entity: r.entity,
          entityId: r.entityId,
          before: r.before,
          after: r.after,
          ip: r.ip,
          userAgent: r.userAgent,
        })),
        nextBefore: rows.length > q.limit ? page.at(-1)!.id : null,
      };
    },
  );
};
