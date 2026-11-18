import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { ledgerEntries, orders, payments, refunds, users } from '../../db/schema/index.js';
import { audit } from '../../lib/audit.js';
import { AppError, notFound } from '../../lib/errors.js';
import { recordOrderFees } from '../finance/ledger.js';
import { issueToken } from '../orders/orders.service.js';
import { PaymentGatewayError, type PaymentGateway } from './gateway.js';

interface Log {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

const paymentsDown = (detail?: string) =>
  new AppError(
    503,
    'SERVICE_UNAVAILABLE',
    'Online payment is not available right now. Try again in a minute.',
    detail ? { detail } : undefined,
  );

/**
 * Step 1 of paying by UPI: a Razorpay order for this MOM order (reused if one already exists,
 * so tapping "Pay" twice never creates two). Returns what the browser's Checkout needs.
 */
export async function startPayment(
  db: Db,
  gateway: PaymentGateway,
  orderId: string,
  userId: string,
  now: Date,
) {
  const [row] = await db
    .select({ order: orders, phone: users.phone, name: users.name })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)));
  if (!row) throw notFound('Order not found');
  const o = row.order;
  if (o.paymentMethod !== 'upi')
    throw new AppError(409, 'CONFLICT', 'This order is paid in cash at the counter.');
  if (o.status !== 'pending_payment') {
    throw new AppError(
      409,
      'CONFLICT',
      o.paymentStatus === 'paid' ? 'This order is already paid.' : 'This order can no longer be paid.',
    );
  }
  if (o.expiresAt && o.expiresAt <= now) {
    throw new AppError(409, 'CONFLICT', 'The time to pay for this order has run out. Please order again.');
  }

  let [payment] = await db
    .select()
    .from(payments)
    .where(
      and(eq(payments.orderId, o.id), eq(payments.status, 'created'), eq(payments.amountPaise, o.totalPaise)),
    )
    .orderBy(desc(payments.createdAt))
    .limit(1);
  if (!payment) {
    let created: { id: string };
    try {
      created = await gateway.createOrder({
        amountPaise: o.totalPaise,
        receipt: o.id,
        notes: { momOrderId: o.id, stallId: o.stallId },
      });
    } catch (err) {
      throw paymentsDown(err instanceof PaymentGatewayError ? err.message : undefined);
    }
    [payment] = await db
      .insert(payments)
      .values({ orderId: o.id, providerOrderId: created.id, amountPaise: o.totalPaise, status: 'created' })
      .returning();
  }
  return {
    keyId: gateway.keyId,
    razorpayOrderId: payment!.providerOrderId,
    amountPaise: o.totalPaise,
    currency: 'INR' as const,
    orderId: o.id,
    expiresAt: o.expiresAt,
    prefill: { contact: row.phone ?? undefined, name: row.name ?? undefined },
  };
}

export type ConfirmOutcome = 'confirmed' | 'already_confirmed' | 'late';

/**
 * The ONE place a UPI payment becomes a placed order — used by the browser's verify call and
 * by the webhook (whichever arrives first wins; the other is a no-op). In one transaction:
 * payment captured → token issued → order placed → MOM's fees in the ledger.
 * A payment for an order that already expired or was cancelled is "late": it's recorded and
 * the caller refunds it.
 */
export async function confirmPayment(
  db: Db,
  input: { razorpayOrderId: string; razorpayPaymentId: string; amountPaise?: number; raw?: unknown },
  now: Date,
): Promise<{ outcome: ConfirmOutcome; orderId: string }> {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.providerOrderId, input.razorpayOrderId))
      .for('update');
    if (!payment) throw notFound('Unknown payment');
    if (input.amountPaise !== undefined && input.amountPaise !== payment.amountPaise) {
      throw new AppError(400, 'BAD_REQUEST', 'Paid amount does not match the order', {
        expected: payment.amountPaise,
        got: input.amountPaise,
      });
    }
    const [order] = await tx.select().from(orders).where(eq(orders.id, payment.orderId)).for('update');
    if (!order) throw notFound('Order not found');

    if (payment.status === 'captured') return { outcome: 'already_confirmed' as const, orderId: order.id };

    await tx
      .update(payments)
      .set({ status: 'captured', providerPaymentId: input.razorpayPaymentId, raw: input.raw ?? null })
      .where(eq(payments.id, payment.id));

    if (order.status !== 'pending_payment') {
      // Paid after the order expired (or was cancelled): keep the money record, refund it.
      await tx.update(orders).set({ paymentStatus: 'refund_pending' }).where(eq(orders.id, order.id));
      return { outcome: 'late' as const, orderId: order.id };
    }

    const token = await issueToken(tx, order.stallId, now);
    await tx
      .update(orders)
      .set({
        status: 'placed',
        paymentStatus: 'paid',
        tokenDay: token.tokenDay,
        tokenNo: token.tokenNo,
        placedAt: now,
        expiresAt: null,
      })
      .where(eq(orders.id, order.id));
    await recordOrderFees(tx, order);
    return { outcome: 'confirmed' as const, orderId: order.id };
  });
}

/**
 * Refunds an order's captured UPI payment in full (spec §4.2): stall rejected it (#18),
 * admin refund (#24), or a late payment for an expired order. Fees already in the ledger are
 * reversed with a matching debit. Safe to call twice: an order is refunded at most once.
 */
export async function refundOrder(
  db: Db,
  gateway: PaymentGateway,
  input: { orderId: string; reason: string; actorId: string | null },
  log: Log,
): Promise<{ refundId: string; status: 'processed' | 'pending' | 'failed' } | null> {
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, input.orderId), eq(payments.status, 'captured')))
    .limit(1);
  if (!payment?.providerPaymentId) return null; // nothing was paid online
  const [already] = await db.select().from(refunds).where(eq(refunds.paymentId, payment.id)).limit(1);
  if (already) return { refundId: already.id, status: already.status };

  let result: Awaited<ReturnType<PaymentGateway['refund']>>;
  try {
    result = await gateway.refund({
      paymentId: payment.providerPaymentId,
      amountPaise: payment.amountPaise,
      notes: { momOrderId: input.orderId, reason: input.reason.slice(0, 200) },
    });
  } catch (err) {
    log.error({ err, orderId: input.orderId }, 'refund failed at the gateway');
    throw paymentsDown(err instanceof PaymentGatewayError ? err.message : undefined);
  }

  return db.transaction(async (tx) => {
    const [refund] = await tx
      .insert(refunds)
      .values({
        paymentId: payment.id,
        orderId: input.orderId,
        amountPaise: payment.amountPaise,
        providerRefundId: result.id,
        status:
          result.status === 'failed' ? 'failed' : result.status === 'processed' ? 'processed' : 'pending',
        reason: input.reason,
        createdBy: input.actorId,
      })
      .returning();
    await tx
      .update(orders)
      .set({ paymentStatus: result.status === 'processed' ? 'refunded' : 'refund_pending' })
      .where(eq(orders.id, input.orderId));

    // Reverse whatever MOM earned on this order.
    const [earned] = await tx
      .select({
        total: sql<number>`coalesce(sum(case when direction = 'credit' then amount_paise else -amount_paise end), 0)::int`,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.orderId, input.orderId));
    const [order] = await tx
      .select({ stallId: orders.stallId })
      .from(orders)
      .where(eq(orders.id, input.orderId));
    if ((earned?.total ?? 0) > 0) {
      await tx.insert(ledgerEntries).values({
        stallId: order!.stallId,
        orderId: input.orderId,
        entryType: 'refund_reversal',
        direction: 'debit',
        amountPaise: earned!.total,
        note: input.reason.slice(0, 200),
        createdBy: input.actorId,
      });
    }
    await audit(tx, {
      actorId: input.actorId,
      action: 'order.refund',
      entity: 'order',
      entityId: input.orderId,
      after: { amountPaise: payment.amountPaise, reason: input.reason, gatewayStatus: result.status },
    });
    log.info({ orderId: input.orderId, refundId: refund!.id, status: result.status }, 'order refunded');
    return { refundId: refund!.id, status: result.status };
  });
}

/** Background job: UPI orders not paid in time become `expired` (spec §4.2 step 5). */
export async function expireUnpaidOrders(db: Db, now: Date): Promise<number> {
  const expired = await db
    .update(orders)
    .set({ status: 'expired', paymentStatus: 'failed', closedAt: now })
    .where(and(eq(orders.status, 'pending_payment'), lte(orders.expiresAt, now)))
    .returning({ id: orders.id });
  return expired.length;
}

/** Marks a failed attempt (from the webhook); the student can try again until the order expires. */
export async function markPaymentFailed(db: Db, razorpayOrderId: string, raw: unknown): Promise<void> {
  await db
    .update(payments)
    .set({ status: 'failed', raw: raw ?? null })
    .where(
      and(eq(payments.providerOrderId, razorpayOrderId), inArray(payments.status, ['created', 'authorized'])),
    );
}
