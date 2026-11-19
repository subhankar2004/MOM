import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { stalls } from '../../db/schema/index.js';
import { audit } from '../../lib/audit.js';
import { AppError, badRequest, conflict, notFound, serviceUnavailable } from '../../lib/errors.js';
import { listStallMembers, type ActorMeta } from '../access/access.service.js';
import {
  PaymentGatewayError,
  type BankAccount,
  type LinkedAccountInput,
  type PaymentGateway,
  type RouteActivation,
} from '../payments/gateway.js';

type StallRow = typeof stalls.$inferSelect;
type StallStatus = StallRow['status'];

/** What a stall needs before students can see it (spec A3 go-live checklist). */
export interface Checklist {
  /** At least one dish students can order. */
  menu: boolean;
  /** Weekly opening hours set. */
  hours: boolean;
  /** A stall photo. */
  photo: boolean;
  /** Cash on, or UPI on with an active settlement account. */
  payments: boolean;
  /** An owner can sign in (member, or phone registered). */
  owner: boolean;
}

const CHECKLIST_LABELS: Record<keyof Checklist, string> = {
  menu: 'a dish on the menu',
  hours: 'opening hours',
  photo: 'a stall photo',
  payments: 'a payment method',
  owner: "the owner's phone number",
};

/** `"stalls"."id"` spelled out: inside a subquery, a bare "id" would mean the inner table's. */
const STALL_ID = sql.raw('"stalls"."id"');

/** Per-stall facts for the checklist, for many stalls in one query. */
const checklistColumns = {
  dishes: sql<number>`(select count(*)::int from menu_items i
    where i.stall_id = ${STALL_ID} and i.deleted_at is null and i.is_available)`,
  hoursSlots: sql<number>`(select count(*)::int from stall_hours h where h.stall_id = ${STALL_ID})`,
  owners: sql<number>`((select count(*) from stall_members m where m.stall_id = ${STALL_ID} and m.role = 'owner')
    + (select count(*) from vendor_invites v
       where v.stall_id = ${STALL_ID} and v.role = 'owner' and v.accepted_at is null))::int`,
};

function checklistOf(
  s: Pick<StallRow, 'photoKey' | 'cashEnabled' | 'upiEnabled' | 'routeStatus'> & {
    dishes: number;
    hoursSlots: number;
    owners: number;
  },
): Checklist {
  return {
    menu: s.dishes > 0,
    hours: s.hoursSlots > 0,
    photo: s.photoKey !== null,
    payments: s.cashEnabled || (s.upiEnabled && s.routeStatus === 'activated'),
    owner: s.owners > 0,
  };
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'stall'
  );
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = (err as { cause?: unknown })?.cause ?? err;
  return (
    (e as { code?: string })?.code === '23505' && (e as { constraint?: string })?.constraint === constraint
  );
}

export interface StallInput {
  name: string;
  slug?: string;
  description?: string | null;
  location?: string | null;
  cuisineTags?: string[];
  isVegOnly?: boolean;
}

/** Stall management for super admins (spec §6.3 A3). Every change is audited. */
export class StallsAdminService {
  private readonly imageBase: string;

  constructor(
    private readonly db: Db,
    private readonly gateway: PaymentGateway | null,
    options: { publicImageBaseUrl: string },
  ) {
    this.imageBase = options.publicImageBaseUrl.replace(/\/$/, '');
  }

  async list(filter: { q?: string; status?: StallStatus }) {
    const q = filter.q?.trim();
    const rows = await this.db
      .select({
        id: stalls.id,
        slug: stalls.slug,
        name: stalls.name,
        location: stalls.location,
        status: stalls.status,
        routeStatus: stalls.routeStatus,
        photoKey: stalls.photoKey,
        cashEnabled: stalls.cashEnabled,
        upiEnabled: stalls.upiEnabled,
        createdAt: stalls.createdAt,
        ...checklistColumns,
      })
      .from(stalls)
      .where(
        and(
          filter.status ? eq(stalls.status, filter.status) : undefined,
          q
            ? or(ilike(stalls.name, `%${escapeLike(q)}%`), ilike(stalls.slug, `%${escapeLike(q)}%`))
            : undefined,
        ),
      )
      .orderBy(asc(stalls.name))
      .limit(200);
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      location: r.location,
      status: r.status,
      routeStatus: r.routeStatus,
      createdAt: r.createdAt,
      checklist: checklistOf(r),
    }));
  }

  async get(stallId: string) {
    const [row] = await this.db
      .select({ stall: stalls, ...checklistColumns })
      .from(stalls)
      .where(eq(stalls.id, stallId));
    if (!row) throw notFound('Stall not found');
    const s = row.stall;
    const people = await listStallMembers(this.db, stallId);
    return {
      stall: {
        id: s.id,
        slug: s.slug,
        name: s.name,
        description: s.description,
        location: s.location,
        cuisineTags: s.cuisineTags,
        isVegOnly: s.isVegOnly,
        status: s.status,
        photoUrl: s.photoKey ? `${this.imageBase}/${s.photoKey}` : null,
        upiEnabled: s.upiEnabled,
        cashEnabled: s.cashEnabled,
        routeStatus: s.routeStatus,
        razorpayAccountId: s.razorpayAccountId,
        createdAt: s.createdAt,
      },
      checklist: checklistOf({ ...s, ...row }),
      ...people,
      /** Test keys can't move real money, so an admin may mark the account active to try UPI. */
      canTestActivate: this.gateway?.keyId.startsWith('rzp_test_') ?? false,
    };
  }

  async create(input: StallInput, actor: ActorMeta) {
    const base = input.slug ?? slugify(input.name);
    if (!SLUG.test(base)) throw badRequest('Use lowercase letters, numbers and dashes for the web address');
    // Free slug: "dosa-corner", then "dosa-corner-2", …
    const taken = new Set(
      (
        await this.db
          .select({ slug: stalls.slug })
          .from(stalls)
          .where(or(eq(stalls.slug, base), ilike(stalls.slug, `${escapeLike(base)}-%`)))
      ).map((r) => r.slug),
    );
    if (input.slug && taken.has(base)) throw conflict('Another stall already uses this web address');
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;

    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(stalls)
        .values({
          name: input.name,
          slug,
          description: input.description || null,
          location: input.location || null,
          cuisineTags: input.cuisineTags ?? [],
          isVegOnly: input.isVegOnly ?? false,
          status: 'draft',
        })
        .returning({ id: stalls.id, slug: stalls.slug });
      await audit(tx, {
        actorId: actor.actorId,
        action: 'stall.create',
        entity: 'stall',
        entityId: row!.id,
        after: { name: input.name, slug },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      return row!;
    });
    return created;
  }

  /**
   * Edits details and status. Going live needs the whole checklist; draft and suspended hide
   * the stall from students (orders already placed carry on).
   */
  async update(stallId: string, patch: Partial<StallInput> & { status?: StallStatus }, actor: ActorMeta) {
    try {
      await this.db.transaction(async (tx) => {
        const [before] = await tx.select().from(stalls).where(eq(stalls.id, stallId)).for('update');
        if (!before) throw notFound('Stall not found');
        const changes: Partial<typeof stalls.$inferInsert> = {};
        if (patch.name !== undefined && patch.name !== before.name) changes.name = patch.name;
        if (patch.slug !== undefined && patch.slug !== before.slug) {
          if (!SLUG.test(patch.slug))
            throw badRequest('Use lowercase letters, numbers and dashes for the web address');
          changes.slug = patch.slug;
        }
        for (const key of ['description', 'location'] as const) {
          const value = patch[key] === '' ? null : patch[key];
          if (value !== undefined && value !== before[key]) changes[key] = value;
        }
        if (patch.cuisineTags !== undefined && patch.cuisineTags.join('|') !== before.cuisineTags.join('|')) {
          changes.cuisineTags = patch.cuisineTags;
        }
        if (patch.isVegOnly !== undefined && patch.isVegOnly !== before.isVegOnly)
          changes.isVegOnly = patch.isVegOnly;
        if (patch.status !== undefined && patch.status !== before.status) {
          if (patch.status === 'active') {
            const missing = await this.missing(tx, stallId);
            if (missing.length > 0) {
              throw new AppError(
                409,
                'CONFLICT',
                `Before going live, add ${joinList(missing.map((m) => CHECKLIST_LABELS[m]))}.`,
                {
                  missing,
                },
              );
            }
          }
          changes.status = patch.status;
        }
        if (Object.keys(changes).length === 0) return;
        await tx.update(stalls).set(changes).where(eq(stalls.id, stallId));
        await audit(tx, {
          actorId: actor.actorId,
          action: changes.status ? `stall.status.${changes.status}` : 'stall.update',
          entity: 'stall',
          entityId: stallId,
          before: Object.fromEntries(Object.keys(changes).map((k) => [k, before[k as keyof StallRow]])),
          after: changes,
          ip: actor.ip,
          userAgent: actor.userAgent,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err, 'stalls_slug_unique'))
        throw conflict('Another stall already uses this web address');
      throw err;
    }
    return this.get(stallId);
  }

  private async missing(db: Db, stallId: string): Promise<Array<keyof Checklist>> {
    const [row] = await db
      .select({ stall: stalls, ...checklistColumns })
      .from(stalls)
      .where(eq(stalls.id, stallId));
    const checklist = checklistOf({ ...row!.stall, ...row! });
    return (Object.keys(checklist) as Array<keyof Checklist>).filter((k) => !checklist[k]);
  }

  /**
   * Sets up the stall's Razorpay Route linked account (spec §4.2), step by step. Each step's
   * result is saved before the next, so if Razorpay refuses something (a wrong IFSC), fixing it
   * and trying again continues where it stopped instead of creating a second account.
   * Bank details go only to Razorpay: MOM never stores or logs them.
   */
  async setUpSettlementAccount(
    stallId: string,
    input: { account: LinkedAccountInput; bank: BankAccount },
    actor: ActorMeta,
  ) {
    const gateway = this.requireGateway();
    const [stall] = await this.db.select().from(stalls).where(eq(stalls.id, stallId));
    if (!stall) throw notFound('Stall not found');
    if (stall.routeStatus === 'activated')
      throw conflict('This stall’s settlement account is already active');

    await this.viaRazorpay(async () => {
      let accountId = stall.razorpayAccountId;
      if (!accountId) {
        accountId = (await gateway.createLinkedAccount(input.account)).id;
        await this.db
          .update(stalls)
          .set({ razorpayAccountId: accountId, routeStatus: 'pending' })
          .where(eq(stalls.id, stallId));
      }
      try {
        await gateway.addStakeholder(accountId, {
          name: input.account.contactName,
          email: input.account.email,
        });
      } catch (err) {
        // Already added on an earlier attempt.
        if (!(err instanceof PaymentGatewayError && /more than one/i.test(err.message))) throw err;
      }
      let productId = stall.razorpayRouteProductId;
      if (!productId) {
        productId = (await gateway.requestRoute(accountId)).id;
        await this.db.update(stalls).set({ razorpayRouteProductId: productId }).where(eq(stalls.id, stallId));
      }
      const product = await gateway.setSettlementAccount(accountId, productId, input.bank);
      await this.saveRouteStatus(stallId, product.activationStatus, actor, 'stall.route.setup', {
        accountId,
        // Enough to recognise the account later, never the full number.
        bankAccount: `XXXX${input.bank.accountNumber.slice(-4)}`,
        ifsc: input.bank.ifsc,
      });
      return product;
    });
    return this.get(stallId);
  }

  /** Asks Razorpay whether the account is active yet. */
  async refreshSettlementAccount(stallId: string, actor: ActorMeta) {
    const gateway = this.requireGateway();
    const [stall] = await this.db.select().from(stalls).where(eq(stalls.id, stallId));
    if (!stall) throw notFound('Stall not found');
    if (!stall.razorpayAccountId || !stall.razorpayRouteProductId) {
      throw conflict('Set up the settlement account first');
    }
    const product = await this.viaRazorpay(() =>
      gateway.fetchRoute(stall.razorpayAccountId!, stall.razorpayRouteProductId!),
    );
    await this.saveRouteStatus(stallId, product.activationStatus, actor, 'stall.route.refresh', {
      razorpayStatus: product.activationStatus,
    });
    return { ...(await this.get(stallId)), requirements: product.requirements };
  }

  /** Test mode only: treat the settlement account as active, so UPI can be tried end to end. */
  async testActivate(stallId: string, actor: ActorMeta) {
    if (!this.gateway?.keyId.startsWith('rzp_test_')) {
      throw new AppError(403, 'FORBIDDEN', 'Only possible with Razorpay test keys');
    }
    await this.saveRouteStatus(stallId, 'activated', actor, 'stall.route.test_activate', { testMode: true });
    return this.get(stallId);
  }

  private async saveRouteStatus(
    stallId: string,
    activation: RouteActivation,
    actor: ActorMeta,
    action: string,
    details: Record<string, unknown>,
  ) {
    const routeStatus =
      activation === 'activated' ? 'activated' : activation === 'suspended' ? 'suspended' : 'pending';
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ routeStatus: stalls.routeStatus })
        .from(stalls)
        .where(eq(stalls.id, stallId))
        .for('update');
      if (!before) throw notFound('Stall not found');
      await tx.update(stalls).set({ routeStatus }).where(eq(stalls.id, stallId));
      await audit(tx, {
        actorId: actor.actorId,
        action,
        entity: 'stall',
        entityId: stallId,
        before: { routeStatus: before.routeStatus },
        after: { routeStatus, ...details },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    });
  }

  private requireGateway(): PaymentGateway {
    if (!this.gateway) throw serviceUnavailable('UPI payments are not configured on this server');
    return this.gateway;
  }

  /** Razorpay's own message for things the admin can fix (a wrong IFSC); 503 when it's down. */
  private async viaRazorpay<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof PaymentGatewayError) {
        if (err.status && err.status < 500) throw badRequest(`Razorpay: ${err.message}`);
        throw serviceUnavailable('Razorpay is not responding. Try again in a minute.');
      }
      throw err;
    }
  }
}

function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
