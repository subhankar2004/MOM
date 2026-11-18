import { timingSafeEqual } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { orders } from '../../db/schema/index.js';
import { audit } from '../../lib/audit.js';
import { AppError, notFound } from '../../lib/errors.js';
import { recordOrderFees } from '../finance/ledger.js';
import { istDay } from '../orders/orders.service.js';
import { verifyPickupQr } from '../orders/pickup-qr.js';
import { boardOrder, type BoardOrder } from './vendor-orders.service.js';

type OrderRow = typeof orders.$inferSelect;

/** Why a pickup can't go ahead (shown as a big ❌ with a reason). */
export type PickupRefusal =
  | 'unknown' // not a MOM code, a forged one, or token + code don't match
  | 'wrong_stall'
  | 'already_collected'
  | 'not_paid'
  | 'cancelled';

export type PickupCheck =
  | { valid: true; order: BoardOrder; warning: 'not_ready' | null; cashDuePaise: number }
  | { valid: false; reason: PickupRefusal; message: string; order: BoardOrder | null };

const MESSAGES: Record<PickupRefusal, string> = {
  unknown: 'Not a valid order. Check the token and code, or scan again.',
  wrong_stall: 'This order is for another stall.',
  already_collected: 'Already collected.',
  not_paid: 'This order was not paid.',
  cancelled: 'This order was cancelled.',
};

function refuse(reason: PickupRefusal, order: BoardOrder | null = null, message?: string): PickupCheck {
  return { valid: false, reason, message: message ?? MESSAGES[reason], order };
}

function sameCode(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The day before an IST date ("2026-11-18" → "2026-11-17"). */
function previousDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Checks an order at the counter (spec §5): from the signed QR, or token + 4-digit pickup code
 * (a token alone is guessable). The order must belong to this stall and be waiting for pickup;
 * placed/preparing are allowed with a warning. Never changes anything.
 */
export async function verifyPickup(
  db: Db,
  input: { stallId: string; qrSecret: string; now: Date } & (
    { qr: string } | { tokenNo: number; pickupCode: string }
  ),
): Promise<PickupCheck> {
  let row: Pick<OrderRow, 'id' | 'stallId' | 'status'> | undefined;
  if ('qr' in input) {
    const orderId = verifyPickupQr(input.qrSecret, input.qr);
    if (!orderId) return refuse('unknown');
    [row] = await db
      .select({ id: orders.id, stallId: orders.stallId, status: orders.status })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!row) return refuse('unknown');
    // A genuine code for another stall: say so, but show nothing about the order.
    if (row.stallId !== input.stallId) return refuse('wrong_stall');
  } else {
    // Today's token, or yesterday's for an order placed just before midnight.
    const today = istDay(input.now);
    const candidates = await db
      .select({
        id: orders.id,
        stallId: orders.stallId,
        status: orders.status,
        pickupCode: orders.pickupCode,
      })
      .from(orders)
      .where(
        and(
          eq(orders.stallId, input.stallId),
          eq(orders.tokenNo, input.tokenNo),
          inArray(orders.tokenDay, [today, previousDay(today)]),
        ),
      )
      .orderBy(desc(orders.tokenDay));
    row = candidates.find((c) => sameCode(c.pickupCode, input.pickupCode));
    if (!row) return refuse('unknown');
  }

  // Unpaid orders never got a token; nothing to show.
  if (row.status === 'pending_payment' || row.status === 'expired') return refuse('not_paid');
  const order = await boardOrder(db, input.stallId, row.id);
  switch (row.status) {
    case 'collected':
      return refuse('already_collected', order, collectedMessage(order));
    case 'rejected':
    case 'cancelled':
      return refuse(
        'cancelled',
        order,
        row.status === 'rejected' ? 'This order was rejected.' : 'The student cancelled this order.',
      );
  }
  return {
    valid: true,
    order,
    warning: row.status === 'ready' ? null : 'not_ready',
    cashDuePaise: order.paymentStatus === 'due' ? order.totalPaise : 0,
  };
}

function collectedMessage(order: BoardOrder): string {
  if (!order.closedAt) return MESSAGES.already_collected;
  const at = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
  }).format(order.closedAt);
  return `Already collected at ${at}.`;
}

/**
 * Hands an order over (→ collected). A cash order must be marked as paid in the same step
 * (`cashReceived`), which also records MOM's fees in the ledger (spec §4.4). Safe against
 * two counters handing over the same order: the second gets "Already collected".
 */
export async function handOver(
  db: Db,
  input: { stallId: string; orderId: string; cashReceived: boolean; actorId: string; now: Date },
): Promise<BoardOrder> {
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.stallId, input.stallId)))
      .for('update');
    if (!order || order.status === 'pending_payment' || order.status === 'expired') {
      throw notFound('Order not found');
    }
    if (order.status === 'collected') {
      throw new AppError(409, 'CONFLICT', 'Already collected.', { status: order.status });
    }
    if (order.status === 'rejected' || order.status === 'cancelled') {
      throw new AppError(409, 'CONFLICT', 'This order was cancelled.', { status: order.status });
    }
    const cashDue = order.paymentMethod === 'cash' && order.paymentStatus === 'due';
    if (cashDue && !input.cashReceived) {
      throw new AppError(409, 'CONFLICT', 'Collect the cash before handing over.', {
        cashDuePaise: order.totalPaise,
      });
    }
    const now = input.now;
    await tx
      .update(orders)
      .set({
        status: 'collected',
        collectedAt: now,
        closedAt: now,
        readyAt: order.readyAt ?? now,
        acceptedAt: order.acceptedAt ?? now,
        ...(cashDue ? { paymentStatus: 'paid_cash' as const } : {}),
      })
      .where(eq(orders.id, order.id));
    // Cash is only MOM's to count once it's in the vendor's hand (UPI fees were recorded at payment).
    if (cashDue) await recordOrderFees(tx, order);
    await audit(tx, {
      actorId: input.actorId,
      action: 'order.handover',
      entity: 'order',
      entityId: order.id,
      before: { status: order.status, paymentStatus: order.paymentStatus },
      after: { status: 'collected', paymentStatus: cashDue ? 'paid_cash' : order.paymentStatus },
    });
  });
  return boardOrder(db, input.stallId, input.orderId);
}
