import { aliasedTable, and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { auditLog, orderItems, orders, payments, refunds, stalls, users } from '../../db/schema/index.js';
import { audit } from '../../lib/audit.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import type { ActorMeta } from '../access/access.service.js';
import type { PaymentGateway } from '../payments/gateway.js';
import { refundOrder } from '../payments/payments.service.js';

type OrderRow = typeof orders.$inferSelect;
export type OrderStatus = OrderRow['status'];
export type PaymentStatus = OrderRow['paymentStatus'];

interface Log {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface OrderFilter {
  /** Order id, "#23" (token), a phone number or a student's name. */
  q?: string;
  stallId?: string;
  status?: OrderStatus;
  paymentMethod?: 'upi' | 'cash';
  paymentStatus?: PaymentStatus;
  /** India dates, inclusive. */
  from?: string;
  to?: string;
  before?: string;
  limit: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const istStart = (day: string) => new Date(`${day}T00:00:00+05:30`);

function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Can't be cancelled any more (already ended). */
const FINISHED: OrderStatus[] = ['collected', 'rejected', 'cancelled', 'expired'];

/** Orders explorer for super admins (spec §6.3 A5): search, timeline, cancel and refund. */
export class OrdersAdminService {
  constructor(
    private readonly db: Db,
    private readonly gateway: PaymentGateway | null,
  ) {}

  async list(f: OrderFilter) {
    const q = f.q?.trim();
    const token = q?.match(/^#?(\d{1,4})$/)?.[1];
    const digits = q?.replace(/\D/g, '') ?? '';
    const search = q
      ? UUID.test(q)
        ? eq(orders.id, q.toLowerCase())
        : or(
            token ? eq(orders.tokenNo, Number(token)) : undefined,
            digits.length >= 5 ? ilike(users.phone, `%${escapeLike(digits.slice(-10))}%`) : undefined,
            ilike(users.name, `%${escapeLike(q)}%`),
          )
      : undefined;
    if (f.from && f.to && f.from > f.to) throw badRequest('"from" must be on or before "to"');

    const rows = await this.db
      .select({
        id: orders.id,
        createdAt: orders.createdAt,
        stall: { id: stalls.id, name: stalls.name },
        student: { id: users.id, name: users.name, phone: users.phone },
        tokenNo: orders.tokenNo,
        status: orders.status,
        paymentMethod: orders.paymentMethod,
        paymentStatus: orders.paymentStatus,
        totalPaise: orders.totalPaise,
      })
      .from(orders)
      .innerJoin(stalls, eq(stalls.id, orders.stallId))
      .innerJoin(users, eq(users.id, orders.userId))
      .where(
        and(
          search,
          f.stallId ? eq(orders.stallId, f.stallId) : undefined,
          f.status ? eq(orders.status, f.status) : undefined,
          f.paymentMethod ? eq(orders.paymentMethod, f.paymentMethod) : undefined,
          f.paymentStatus ? eq(orders.paymentStatus, f.paymentStatus) : undefined,
          f.from ? sql`${orders.createdAt} >= ${istStart(f.from)}` : undefined,
          f.to ? sql`${orders.createdAt} < ${new Date(istStart(f.to).getTime() + 86_400_000)}` : undefined,
          f.before
            ? sql`(${orders.createdAt}, ${orders.id}) < (select o.created_at, o.id from orders o where o.id = ${f.before})`
            : undefined,
        ),
      )
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(f.limit + 1);
    const page = rows.slice(0, f.limit);
    return { orders: page, nextBefore: rows.length > f.limit ? page.at(-1)!.id : null };
  }

  /** Everything about one order, with a timeline of what happened and who did it. */
  async get(orderId: string) {
    const [row] = await this.db
      .select({
        order: orders,
        stall: { id: stalls.id, name: stalls.name, slug: stalls.slug },
        student: { id: users.id, name: users.name, phone: users.phone },
      })
      .from(orders)
      .innerJoin(stalls, eq(stalls.id, orders.stallId))
      .innerJoin(users, eq(users.id, orders.userId))
      .where(eq(orders.id, orderId));
    if (!row) throw notFound('Order not found');
    const o = row.order;
    const actor = aliasedTable(users, 'actor');
    const [items, paymentRows, refundRows, events] = await Promise.all([
      this.db
        .select({
          name: orderItems.nameSnapshot,
          quantity: orderItems.quantity,
          unitPricePaise: orderItems.unitPricePaise,
          lineTotalPaise: orderItems.lineTotalPaise,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId))
        .orderBy(asc(orderItems.id)),
      this.db
        .select({
          id: payments.id,
          providerPaymentId: payments.providerPaymentId,
          amountPaise: payments.amountPaise,
          status: payments.status,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .where(eq(payments.orderId, orderId))
        .orderBy(asc(payments.createdAt)),
      this.db
        .select({
          id: refunds.id,
          amountPaise: refunds.amountPaise,
          status: refunds.status,
          reason: refunds.reason,
          createdAt: refunds.createdAt,
        })
        .from(refunds)
        .where(eq(refunds.orderId, orderId))
        .orderBy(asc(refunds.createdAt)),
      this.db
        .select({
          at: auditLog.createdAt,
          action: auditLog.action,
          after: auditLog.after,
          actorName: actor.name,
          actorRole: actor.role,
        })
        .from(auditLog)
        .leftJoin(actor, eq(actor.id, auditLog.actorId))
        .where(and(eq(auditLog.entity, 'order'), eq(auditLog.entityId, orderId)))
        .orderBy(asc(auditLog.createdAt), asc(auditLog.id)),
    ]);

    // Status timestamps (always there), plus who did what from the audit log.
    const timeline: Array<{ at: Date; label: string; by: string | null }> = [
      { at: o.createdAt, label: 'Order placed', by: 'Student' },
      ...(o.placedAt && o.paymentMethod === 'upi'
        ? [{ at: o.placedAt, label: 'Paid by UPI, token issued', by: null }]
        : []),
      ...events.map((e) => ({
        at: e.at,
        label: describe(e.action, e.after as Record<string, unknown> | null),
        by: e.actorName
          ? `${e.actorName}${e.actorRole === 'super_admin' ? ' (MOM admin)' : ''}`
          : e.actorRole
            ? null
            : 'System',
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    return {
      order: {
        id: o.id,
        status: o.status,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        tokenNo: o.tokenNo,
        tokenDay: o.tokenDay,
        note: o.note,
        reason: o.rejectReason,
        subtotalPaise: o.subtotalPaise,
        platformFeePaise: o.platformFeePaise,
        cashFeePaise: o.cashFeePaise,
        totalPaise: o.totalPaise,
        createdAt: o.createdAt,
        placedAt: o.placedAt,
        acceptedAt: o.acceptedAt,
        readyAt: o.readyAt,
        collectedAt: o.collectedAt,
        closedAt: o.closedAt,
      },
      stall: row.stall,
      student: row.student,
      items,
      payments: paymentRows,
      refunds: refundRows,
      timeline,
      can: {
        cancel: !FINISHED.includes(o.status),
        refund: canRefund(o),
      },
    };
  }

  /**
   * MOM cancels an order (e.g. the stall closed suddenly). A paid UPI order is refunded in
   * full; if Razorpay can't be reached the order is still cancelled and marked refund_pending,
   * so the refund can be retried from here.
   */
  async cancel(orderId: string, reason: string, actor: ActorMeta, now: Date, log: Log) {
    const wasPaid = await this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order) throw notFound('Order not found');
      if (FINISHED.includes(order.status)) {
        throw new AppError(409, 'CONFLICT', `This order is already ${order.status}.`, {
          status: order.status,
        });
      }
      await tx
        .update(orders)
        .set({ status: 'cancelled', closedAt: now, rejectReason: reason })
        .where(eq(orders.id, orderId));
      await audit(tx, {
        actorId: actor.actorId,
        action: 'order.cancel_by_admin',
        entity: 'order',
        entityId: orderId,
        before: { status: order.status, paymentStatus: order.paymentStatus },
        after: { status: 'cancelled', reason },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      return order.paymentStatus === 'paid';
    });
    let refund: 'started' | 'retry_later' | 'none' = 'none';
    if (wasPaid) refund = await this.tryRefund(orderId, `Cancelled by MOM: ${reason}`, actor, log);
    return { ...(await this.get(orderId)), refund };
  }

  /**
   * Refunds a UPI order's payment in full without changing its status (e.g. a complaint after
   * pickup), or retries a refund that couldn't start before (refund_pending).
   */
  async refund(orderId: string, reason: string, actor: ActorMeta, log: Log) {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, orderId));
    if (!order) throw notFound('Order not found');
    if (!canRefund(order)) {
      throw new AppError(
        409,
        'CONFLICT',
        order.paymentMethod === 'cash'
          ? 'Cash orders are paid at the counter; there is no online payment to refund.'
          : order.paymentStatus === 'refunded'
            ? 'This order has already been refunded.'
            : ['placed', 'preparing', 'ready'].includes(order.status)
              ? 'This order is still open. Cancel it instead: that refunds it too.'
              : 'There is no captured payment to refund.',
      );
    }
    if (!this.gateway) throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Refunds are not available right now.');
    await audit(this.db, {
      actorId: actor.actorId,
      action: 'order.refund_requested_by_admin',
      entity: 'order',
      entityId: orderId,
      after: { reason, paymentStatus: order.paymentStatus },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    // Errors here (Razorpay down) reach the admin as 503; the order is unchanged and can be retried.
    await refundOrder(
      this.db,
      this.gateway,
      { orderId, reason: `MOM refund: ${reason}`, actorId: actor.actorId },
      log,
    );
    return this.get(orderId);
  }

  private async tryRefund(orderId: string, reason: string, actor: ActorMeta, log: Log) {
    try {
      if (!this.gateway) throw new Error('no payment gateway configured');
      await refundOrder(this.db, this.gateway, { orderId, reason, actorId: actor.actorId }, log);
      return 'started' as const;
    } catch (err) {
      log.error({ err, orderId }, 'order cancelled but the refund could not start');
      await this.db.update(orders).set({ paymentStatus: 'refund_pending' }).where(eq(orders.id, orderId));
      return 'retry_later' as const;
    }
  }
}

function canRefund(o: Pick<OrderRow, 'paymentMethod' | 'paymentStatus' | 'status'>): boolean {
  if (o.paymentMethod !== 'upi') return false;
  if (o.paymentStatus === 'refund_pending') return true;
  return (
    o.paymentStatus === 'paid' &&
    (o.status === 'collected' || o.status === 'rejected' || o.status === 'cancelled')
  );
}

/** Audit actions in plain words for the timeline. */
function describe(action: string, after: Record<string, unknown> | null): string {
  const reason = typeof after?.reason === 'string' ? `: “${after.reason}”` : '';
  switch (action) {
    case 'order.accept':
      return 'Accepted by the stall';
    case 'order.ready':
      return 'Marked ready';
    case 'order.reject':
      return `Rejected by the stall${reason}`;
    case 'order.handover':
      return after?.paymentStatus === 'paid_cash' ? 'Cash received, handed over' : 'Handed over';
    case 'order.cancel_by_student':
      return 'Cancelled by the student';
    case 'order.cancel_by_admin':
      return `Cancelled by MOM${reason}`;
    case 'order.refund':
      return `Refund ${after?.gatewayStatus === 'processed' ? 'processed' : 'started'}`;
    case 'order.refund_requested_by_admin':
      return `Refund requested by MOM${reason}`;
    default:
      return action.replace(/^order\./, '').replace(/[._]/g, ' ');
  }
}
