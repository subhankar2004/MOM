import { randomInt } from 'node:crypto';
import { calcFees, type PaymentMethod } from '@mom/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  menuItems,
  orderItems,
  orders,
  stallHours,
  stalls,
  tokenCounters,
  users,
} from '../../db/schema/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { getCurrentSettings } from '../settings/settings.service.js';
import { availability } from '../stalls/availability.js';

export interface PlaceOrderInput {
  userId: string;
  stallId: string;
  items: Array<{ itemId: string; quantity: number }>;
  paymentMethod: PaymentMethod;
  note?: string;
  /** The total the student was shown. If prices changed since, the order is refused. */
  expectedTotalPaise: number;
  idempotencyKey: string;
  /** False when no payment gateway is configured: UPI orders are refused. */
  upiOnline: boolean;
}

/** IST calendar date (YYYY-MM-DD) — token numbers restart every day, India time. */
export function istDay(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** 4 random digits from the OS CSPRNG, checked with the token at pickup (spec §5). */
function pickupCode(): string {
  return randomInt(0, 10_000).toString().padStart(4, '0');
}

const ACTIVE = ['placed', 'preparing', 'ready'] as const;

/** The order as its owner sees it. */
export async function getOrderForUser(db: Db, orderId: string, userId: string) {
  const [row] = await db
    .select({
      order: orders,
      stall: { id: stalls.id, slug: stalls.slug, name: stalls.name, location: stalls.location },
    })
    .from(orders)
    .innerJoin(stalls, eq(stalls.id, orders.stallId))
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)));
  // Someone else's order is "not found", not "forbidden": order ids are never confirmed to outsiders.
  if (!row) throw notFound('Order not found');
  const items = await db
    .select({
      itemId: orderItems.menuItemId,
      name: orderItems.nameSnapshot,
      quantity: orderItems.quantity,
      unitPricePaise: orderItems.unitPricePaise,
      lineTotalPaise: orderItems.lineTotalPaise,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.id));
  const o = row.order;
  return {
    id: o.id,
    stall: row.stall,
    status: o.status,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    tokenNo: o.tokenNo,
    tokenDay: o.tokenDay,
    pickupCode: o.pickupCode,
    note: o.note,
    items,
    subtotalPaise: o.subtotalPaise,
    platformFeePaise: o.platformFeePaise,
    cashFeePaise: o.cashFeePaise,
    totalPaise: o.totalPaise,
    platformFeeBps: o.platformFeeBps,
    cashFeeBps: o.cashFeeBps,
    createdAt: o.createdAt,
    expiresAt: o.expiresAt,
  };
}

export type OrderView = Awaited<ReturnType<typeof getOrderForUser>>;

/**
 * Places an order (spec §4, §5) in ONE transaction:
 *  re-price → check stall/method/cash limits → snapshot fees → order + lines → token (cash).
 * Idempotent per (user, Idempotency-Key): a retry returns the first order unchanged.
 */
export async function placeOrder(
  db: Db,
  input: PlaceOrderInput,
  now: Date,
): Promise<{ order: OrderView; replayed: boolean }> {
  const existing = await findByKey(db, input.userId, input.idempotencyKey);
  if (existing) return { order: await replayCheck(db, existing, input), replayed: true };

  try {
    const result = await db.transaction(async (tx): Promise<{ orderId: string; replayed: boolean }> => {
      // 1. Lock the student's row: their orders are placed one at a time, so two quick
      //    taps can't both slip under the cash-order limit.
      const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).for('update');
      if (!user || user.deletedAt) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in again');
      if (user.status === 'suspended') {
        throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact MOM support.');
      }
      // Check the key again now that we hold the lock: a simultaneous retry of the same checkout
      // waited behind the first request, which has committed its order by now.
      const already = await findByKey(tx, input.userId, input.idempotencyKey);
      if (already) {
        await replayCheck(tx, already, input);
        return { orderId: already.id, replayed: true };
      }

      // 2. The stall must be open, taking orders, and accept this payment method.
      const [stall] = await tx.select().from(stalls).where(eq(stalls.id, input.stallId));
      if (!stall || stall.status !== 'active') throw notFound('This stall is no longer on MOM');
      const hours = await tx.select().from(stallHours).where(eq(stallHours.stallId, stall.id));
      const state = availability(
        {
          status: stall.status,
          isOpenOverride: stall.isOpenOverride,
          acceptingOrders: stall.acceptingOrders,
          hours,
        },
        now,
      ).state;
      if (state !== 'open') {
        throw new AppError(
          409,
          'STALL_UNAVAILABLE',
          state === 'paused'
            ? `${stall.name} isn't taking new orders right now. Try again in a few minutes.`
            : `${stall.name} is closed right now.`,
          { state },
        );
      }
      const upiAccepted = input.upiOnline && stall.upiEnabled && stall.routeStatus === 'activated';
      if (
        (input.paymentMethod === 'upi' && !upiAccepted) ||
        (input.paymentMethod === 'cash' && !stall.cashEnabled)
      ) {
        throw new AppError(
          409,
          'PAYMENT_METHOD_UNAVAILABLE',
          `${stall.name} doesn't accept ${input.paymentMethod === 'upi' ? 'UPI' : 'cash'} right now.`,
        );
      }

      // 3. Re-price every dish from the database. Anything different from the cart the student
      //    saw (gone, sold out, new price) → refuse, so we never charge a total they didn't see.
      const ids = input.items.map((i) => i.itemId);
      const rows = await tx
        .select()
        .from(menuItems)
        .where(and(inArray(menuItems.id, ids), eq(menuItems.stallId, stall.id), isNull(menuItems.deletedAt)));
      const lines = input.items.map((wanted) => {
        const item = rows.find((r) => r.id === wanted.itemId);
        if (!item || !item.isAvailable) {
          throw new AppError(409, 'CART_CHANGED', 'Some dishes in your cart are no longer available.', {
            reason: 'unavailable',
            itemId: wanted.itemId,
          });
        }
        return { item, quantity: wanted.quantity, lineTotalPaise: item.pricePaise * wanted.quantity };
      });

      const settings = await getCurrentSettings(tx);
      const rates = { platformFeeBps: settings.platformFeeBps, cashFeeBps: settings.cashFeeBps };
      const subtotal = lines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
      const fees = calcFees(subtotal, input.paymentMethod, rates);
      if (fees.totalPaise !== input.expectedTotalPaise) {
        throw new AppError(
          409,
          'CART_CHANGED',
          'Prices changed since you opened checkout. Check the new total.',
          {
            reason: 'price',
            totalPaise: fees.totalPaise,
          },
        );
      }

      // 4. Cash rules (spec §4.3): limited open cash orders, and no cash after too many no-shows.
      if (input.paymentMethod === 'cash') {
        if (user.cashStrikes >= settings.cashStrikeLimit) {
          throw new AppError(
            403,
            'CASH_BLOCKED',
            'Cash ordering is off for your account after missed pickups. Pay by UPI, or contact MOM support.',
          );
        }
        const [open] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(orders)
          .where(
            and(
              eq(orders.userId, user.id),
              eq(orders.paymentMethod, 'cash'),
              inArray(orders.status, [...ACTIVE]),
            ),
          );
        if ((open?.n ?? 0) >= settings.maxOpenCashOrders) {
          throw new AppError(
            409,
            'CASH_LIMIT_REACHED',
            `You already have ${open!.n} cash orders waiting. Collect one first, or pay by UPI.`,
            { limit: settings.maxOpenCashOrders },
          );
        }
      }

      // 5. Cash orders get their token now; UPI orders when the payment is confirmed (#15).
      const isCash = input.paymentMethod === 'cash';
      let token: { tokenDay: string; tokenNo: number } | null = null;
      if (isCash) token = await issueToken(tx, stall.id, now);

      const [order] = await tx
        .insert(orders)
        .values({
          userId: user.id,
          stallId: stall.id,
          tokenDay: token?.tokenDay ?? null,
          tokenNo: token?.tokenNo ?? null,
          pickupCode: pickupCode(),
          status: isCash ? 'placed' : 'pending_payment',
          paymentMethod: input.paymentMethod,
          paymentStatus: isCash ? 'due' : 'pending',
          subtotalPaise: fees.subtotalPaise,
          platformFeePaise: fees.platformFeePaise,
          cashFeePaise: fees.cashFeePaise,
          totalPaise: fees.totalPaise,
          platformFeeBps: rates.platformFeeBps,
          cashFeeBps: rates.cashFeeBps,
          settingsId: settings.id,
          note: input.note?.trim() || null,
          idempotencyKey: input.idempotencyKey,
          placedAt: isCash ? now : null,
          expiresAt: isCash ? null : new Date(now.getTime() + settings.orderExpiryMinutes * 60_000),
        })
        .returning({ id: orders.id });

      await tx.insert(orderItems).values(
        lines.map((l) => ({
          orderId: order!.id,
          menuItemId: l.item.id,
          nameSnapshot: l.item.name,
          unitPricePaise: l.item.pricePaise,
          quantity: l.quantity,
          lineTotalPaise: l.lineTotalPaise,
        })),
      );
      return { orderId: order!.id, replayed: false };
    });
    return { order: await getOrderForUser(db, result.orderId, input.userId), replayed: result.replayed };
  } catch (err) {
    // Two requests with the same key raced: the other one won — return its order.
    if (isUniqueViolation(err, 'orders_user_idempotency_unique')) {
      const winner = await findByKey(db, input.userId, input.idempotencyKey);
      if (winner) return { order: await replayCheck(db, winner, input), replayed: true };
    }
    throw err;
  }
}

/**
 * Next token for the stall today (IST). One atomic upsert: the row lock it takes makes
 * parallel orders queue up, so tokens are 1, 2, 3… with no gaps or duplicates.
 */
export async function issueToken(db: Db, stallId: string, now: Date) {
  const tokenDay = istDay(now);
  const [row] = await db
    .insert(tokenCounters)
    .values({ stallId, day: tokenDay, lastToken: 1 })
    .onConflictDoUpdate({
      target: [tokenCounters.stallId, tokenCounters.day],
      set: { lastToken: sql`${tokenCounters.lastToken} + 1` },
    })
    .returning({ lastToken: tokenCounters.lastToken });
  return { tokenDay, tokenNo: row!.lastToken };
}

async function findByKey(db: Db, userId: string, key: string) {
  const [row] = await db
    .select({ id: orders.id, stallId: orders.stallId, paymentMethod: orders.paymentMethod })
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, key)));
  return row;
}

/** A replay must be for the same stall and payment method; otherwise the key was reused by mistake. */
async function replayCheck(
  db: Db,
  existing: { id: string; stallId: string; paymentMethod: string },
  input: PlaceOrderInput,
) {
  if (existing.stallId !== input.stallId || existing.paymentMethod !== input.paymentMethod) {
    throw new AppError(409, 'IDEMPOTENCY_MISMATCH', 'This checkout was already used for a different order.');
  }
  return getOrderForUser(db, existing.id, input.userId);
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = (err as { cause?: unknown })?.cause ?? err;
  return (
    (e as { code?: string })?.code === '23505' && (e as { constraint?: string })?.constraint === constraint
  );
}
