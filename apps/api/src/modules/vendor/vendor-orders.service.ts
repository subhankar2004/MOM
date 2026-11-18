import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { orderItems, orders } from '../../db/schema/index.js';
import { audit } from '../../lib/audit.js';
import { AppError, notFound } from '../../lib/errors.js';
import type { PaymentGateway } from '../payments/gateway.js';
import { refundOrder } from '../payments/payments.service.js';

interface Log {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** On the board until collected (#21) or rejected. */
const BOARD = ['placed', 'preparing', 'ready'] as const;
const FINISHED = ['collected', 'rejected', 'cancelled'] as const;

type OrderRow = typeof orders.$inferSelect;

/** One order as the stall sees it: what to cook, how it's paid. No student details. */
export interface BoardOrder {
  id: string;
  tokenNo: number;
  status: OrderRow['status'];
  paymentMethod: OrderRow['paymentMethod'];
  paymentStatus: OrderRow['paymentStatus'];
  totalPaise: number;
  note: string | null;
  rejectReason: string | null;
  items: Array<{ name: string; quantity: number }>;
  placedAt: Date | null;
  acceptedAt: Date | null;
  readyAt: Date | null;
  closedAt: Date | null;
}

/** Start of the current IST day, as an instant. */
function istDayStart(now: Date): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - 330 * 60_000);
}

const pick = {
  id: orders.id,
  tokenNo: orders.tokenNo,
  status: orders.status,
  paymentMethod: orders.paymentMethod,
  paymentStatus: orders.paymentStatus,
  totalPaise: orders.totalPaise,
  note: orders.note,
  rejectReason: orders.rejectReason,
  placedAt: orders.placedAt,
  acceptedAt: orders.acceptedAt,
  readyAt: orders.readyAt,
  closedAt: orders.closedAt,
};

async function withItems(
  db: Db,
  rows: Array<Omit<BoardOrder, 'items' | 'tokenNo'> & { tokenNo: number | null }>,
) {
  const ids = rows.map((o) => o.id);
  const lines = ids.length
    ? await db
        .select({ orderId: orderItems.orderId, name: orderItems.nameSnapshot, quantity: orderItems.quantity })
        .from(orderItems)
        .where(inArray(orderItems.orderId, ids))
        .orderBy(asc(orderItems.id))
    : [];
  return rows.map((o): BoardOrder => ({
    ...o,
    tokenNo: o.tokenNo ?? 0,
    items: lines.filter((l) => l.orderId === o.id).map(({ name, quantity }) => ({ name, quantity })),
  }));
}

/**
 * The live board (spec §6.2 V1): every order waiting to be accepted, cooked or collected
 * (oldest first — first come, first served), plus today's finished orders (newest first).
 * UPI orders appear only once paid.
 */
export async function stallBoard(
  db: Db,
  stallId: string,
  now: Date,
): Promise<{ active: BoardOrder[]; finishedToday: BoardOrder[] }> {
  const [active, finished] = await Promise.all([
    db
      .select(pick)
      .from(orders)
      .where(and(eq(orders.stallId, stallId), inArray(orders.status, [...BOARD])))
      .orderBy(asc(orders.placedAt), asc(orders.tokenNo))
      .limit(200),
    db
      .select(pick)
      .from(orders)
      .where(
        and(
          eq(orders.stallId, stallId),
          inArray(orders.status, [...FINISHED]),
          gte(orders.placedAt, istDayStart(now)),
        ),
      )
      .orderBy(desc(sql`coalesce(${orders.closedAt}, ${orders.collectedAt}, ${orders.updatedAt})`))
      .limit(50),
  ]);
  const all = await withItems(db, [...active, ...finished]);
  return { active: all.slice(0, active.length), finishedToday: all.slice(active.length) };
}

/** One of the stall's orders, as on the board. */
export async function boardOrder(db: Db, stallId: string, orderId: string): Promise<BoardOrder> {
  const rows = await db
    .select(pick)
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.stallId, stallId)));
  if (!rows[0]) throw notFound('Order not found');
  return (await withItems(db, rows))[0]!;
}

export type BoardAction = 'accept' | 'ready' | 'reject';

/** Which statuses each action may start from (spec §5 order lifecycle). */
const ALLOWED_FROM: Record<BoardAction, ReadonlyArray<OrderRow['status']>> = {
  accept: ['placed'],
  // A stall may hand over something instant (a cold drink) without "accepting" first.
  ready: ['placed', 'preparing'],
  reject: ['placed', 'preparing'],
};
const TARGET = { accept: 'preparing', ready: 'ready', reject: 'rejected' } as const;

/**
 * Moves an order along the board. Enforced here, not in the UI: the order must belong to
 * the stall and be in an allowed status. Repeating the same action (a double tap, two
 * tablets at one counter) is a no-op. Rejecting a paid UPI order refunds it in full.
 */
export async function moveOrder(
  db: Db,
  gateway: PaymentGateway | null,
  input: {
    stallId: string;
    orderId: string;
    action: BoardAction;
    reason?: string;
    actorId: string;
    now: Date;
  },
  log: Log,
): Promise<{ refund: 'started' | 'retry_later' | 'none' }> {
  const target = TARGET[input.action];
  const refundNeeded = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.stallId, input.stallId)))
      .for('update');
    // pending_payment orders aren't on the board yet: treat them as unknown to the stall.
    if (!order || order.status === 'pending_payment') throw notFound('Order not found');
    if (order.status === target) return false;
    if (!ALLOWED_FROM[input.action].includes(order.status)) {
      throw new AppError(409, 'CONFLICT', conflictMessage(order.status), { status: order.status });
    }
    const now = input.now;
    await tx
      .update(orders)
      .set(
        input.action === 'accept'
          ? { status: 'preparing', acceptedAt: now }
          : input.action === 'ready'
            ? { status: 'ready', readyAt: now, acceptedAt: order.acceptedAt ?? now }
            : { status: 'rejected', rejectReason: input.reason!, closedAt: now },
      )
      .where(eq(orders.id, order.id));
    await audit(tx, {
      actorId: input.actorId,
      action: `order.${input.action}`,
      entity: 'order',
      entityId: order.id,
      before: { status: order.status },
      after: { status: target, ...(input.reason ? { reason: input.reason } : {}) },
    });
    return input.action === 'reject' && order.paymentStatus === 'paid';
  });

  if (!refundNeeded) return { refund: 'none' };
  try {
    if (!gateway) throw new Error('no payment gateway configured');
    await refundOrder(
      db,
      gateway,
      { orderId: input.orderId, reason: `Rejected by the stall: ${input.reason}`, actorId: input.actorId },
      log,
    );
    return { refund: 'started' };
  } catch (err) {
    // The rejection stands. Mark the money as owed back so it shows up for a retry (admin,
    // #24) instead of the order looking paid. Never lose track of a student's money.
    log.error({ err, orderId: input.orderId }, 'order rejected but the refund could not start');
    await db.update(orders).set({ paymentStatus: 'refund_pending' }).where(eq(orders.id, input.orderId));
    return { refund: 'retry_later' };
  }
}

function conflictMessage(status: OrderRow['status']): string {
  switch (status) {
    case 'ready':
      return 'This order is already marked ready.';
    case 'preparing':
      return 'This order is already being prepared.';
    case 'collected':
      return 'This order has already been collected.';
    case 'cancelled':
      return 'The student cancelled this order.';
    case 'rejected':
      return 'This order was already rejected.';
    default:
      return 'This order can’t be changed now.';
  }
}
