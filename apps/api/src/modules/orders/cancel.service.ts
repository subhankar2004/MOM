import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { orders } from '../../db/schema/index.js';
import { audit } from '../../lib/audit.js';
import { AppError, notFound } from '../../lib/errors.js';
import type { PaymentGateway } from '../payments/gateway.js';
import { refundOrder } from '../payments/payments.service.js';

interface Log {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/**
 * A student cancels their own order (spec §5): only before the stall starts preparing.
 * A paid UPI order is refunded in full.
 */
export async function cancelOrderByStudent(
  db: Db,
  gateway: PaymentGateway | null,
  input: { orderId: string; userId: string; now: Date },
  log: Log,
): Promise<void> {
  const wasPaid = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.userId, input.userId)))
      .for('update');
    if (!order) throw notFound('Order not found');
    if (order.status !== 'pending_payment' && order.status !== 'placed') {
      throw new AppError(
        409,
        'CONFLICT',
        order.status === 'preparing' || order.status === 'ready'
          ? 'The stall has already started on this order, so it can’t be cancelled now.'
          : 'This order is already finished.',
      );
    }
    await tx.update(orders).set({ status: 'cancelled', closedAt: input.now }).where(eq(orders.id, order.id));
    await audit(tx, {
      actorId: input.userId,
      action: 'order.cancel_by_student',
      entity: 'order',
      entityId: order.id,
      before: { status: order.status, paymentStatus: order.paymentStatus },
      after: { status: 'cancelled' },
    });
    return order.paymentStatus === 'paid';
  });

  if (wasPaid) {
    if (!gateway) throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Refunds are not available right now.');
    await refundOrder(
      db,
      gateway,
      { orderId: input.orderId, reason: 'Cancelled by the student', actorId: input.userId },
      log,
    );
  }
}
