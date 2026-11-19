import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { orders, payments, stalls, transfers } from '../../db/schema/index.js';
import { PaymentGatewayError, type PaymentGateway } from '../payments/gateway.js';

interface Log {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** After this many failed Razorpay calls, a transfer is marked failed for an admin to look at. */
const MAX_ATTEMPTS = 5;

type Outcome = 'done' | 'skipped' | 'retry_later' | 'failed';

const message = (err: unknown) =>
  err instanceof PaymentGatewayError ? err.message : err instanceof Error ? err.message : String(err);

/**
 * Pays a stall its share of a UPI order through Razorpay Route (spec §4.2 step 6): the food
 * subtotal goes to the stall's linked account, HELD until the student collects; MOM keeps the
 * platform fee. Safe to call again at any time (the retry job does): the transfer row is the
 * record, and before creating at Razorpay we look for one already made for this order, so a
 * lost response never pays a stall twice.
 */
export async function ensureTransfer(
  db: Db,
  gateway: PaymentGateway,
  orderId: string,
  log: Log,
): Promise<Outcome> {
  const [row] = await db
    .select({
      order: orders,
      account: stalls.razorpayAccountId,
      paymentId: payments.providerPaymentId,
      refunded: sql<boolean>`exists (select 1 from refunds r where r.order_id = ${orders.id})`,
    })
    .from(orders)
    .innerJoin(stalls, eq(stalls.id, orders.stallId))
    .leftJoin(payments, and(eq(payments.orderId, orders.id), eq(payments.status, 'captured')))
    .where(eq(orders.id, orderId));
  const o = row?.order;
  // Only confirmed, still-paid UPI orders of stalls with a linked account are paid out.
  if (!o || o.paymentMethod !== 'upi' || !o.placedAt || !row.paymentId || row.refunded) return 'skipped';
  if (!row.account) {
    log.warn({ orderId }, 'UPI order at a stall without a Razorpay linked account: no transfer');
    return 'skipped';
  }

  await db
    .insert(transfers)
    .values({ orderId, stallId: o.stallId, amountPaise: o.subtotalPaise, status: 'created' })
    .onConflictDoNothing({ target: transfers.orderId });
  const [t] = await db.select().from(transfers).where(eq(transfers.orderId, orderId));
  if (!t || t.providerTransferId || t.status !== 'created') return 'done';

  try {
    const existing = (await gateway.listTransfers(row.paymentId)).find((x) => x.orderId === orderId);
    const made =
      existing ??
      (await gateway.createTransfer(row.paymentId, {
        account: row.account,
        amountPaise: t.amountPaise,
        orderId,
      }));
    await db
      .update(transfers)
      .set({
        providerTransferId: made.id,
        status: made.onHold ? 'on_hold' : 'released',
        attempts: t.attempts + 1,
        lastError: null,
      })
      .where(eq(transfers.id, t.id));
    log.info({ orderId, transferId: made.id, adopted: Boolean(existing) }, 'transfer created (held)');
    return 'done';
  } catch (err) {
    return recordFailure(db, t.id, t.attempts, err, log, { orderId, step: 'create' });
  }
}

/** The student collected: let Razorpay settle the stall's money to its bank. */
export async function releaseTransfer(
  db: Db,
  gateway: PaymentGateway,
  orderId: string,
  now: Date,
  log: Log,
): Promise<Outcome> {
  const [t] = await db.select().from(transfers).where(eq(transfers.orderId, orderId));
  if (!t || t.status !== 'on_hold' || !t.providerTransferId)
    return t?.status === 'released' ? 'done' : 'skipped';
  try {
    await gateway.releaseTransfer(t.providerTransferId);
    await db
      .update(transfers)
      .set({ status: 'released', releasedAt: now, attempts: t.attempts + 1, lastError: null })
      .where(eq(transfers.id, t.id));
    log.info({ orderId, transferId: t.providerTransferId }, 'transfer released');
    return 'done';
  } catch (err) {
    return recordFailure(db, t.id, t.attempts, err, log, { orderId, step: 'release' }, false);
  }
}

/**
 * The order was refunded: take the stall's share back. Before collection the money is still
 * held, so nothing ever leaves the stall's bank (spec §4.2). A transfer never sent is simply
 * closed.
 */
export async function reverseTransfer(
  db: Db,
  gateway: PaymentGateway,
  orderId: string,
  now: Date,
  log: Log,
): Promise<Outcome> {
  const [t] = await db.select().from(transfers).where(eq(transfers.orderId, orderId));
  if (!t || t.status === 'reversed') return t ? 'done' : 'skipped';
  if (!t.providerTransferId) {
    await db.update(transfers).set({ status: 'reversed', reversedAt: now }).where(eq(transfers.id, t.id));
    return 'done';
  }
  try {
    const reversal = await gateway.reverseTransfer(t.providerTransferId, t.amountPaise);
    await db
      .update(transfers)
      .set({ status: 'reversed', reversedAt: now, attempts: t.attempts + 1, lastError: null })
      .where(eq(transfers.id, t.id));
    log.info({ orderId, transferId: t.providerTransferId, reversalId: reversal.id }, 'transfer reversed');
    return 'done';
  } catch (err) {
    return recordFailure(db, t.id, t.attempts, err, log, { orderId, step: 'reverse' }, false);
  }
}

/**
 * Records a failed Razorpay call. Creating gives up after MAX_ATTEMPTS (status failed, shown to
 * admins); release and reversal keep their status and are retried, because the transfer
 * exists and only its hold or reversal is pending.
 */
async function recordFailure(
  db: Db,
  id: string,
  attempts: number,
  err: unknown,
  log: Log,
  ctx: { orderId: string; step: string },
  canGiveUp = true,
): Promise<Outcome> {
  const giveUp = canGiveUp && attempts + 1 >= MAX_ATTEMPTS;
  await db
    .update(transfers)
    .set({
      attempts: attempts + 1,
      lastError: `${ctx.step}: ${message(err)}`.slice(0, 500),
      ...(giveUp ? { status: 'failed' as const } : {}),
    })
    .where(eq(transfers.id, id));
  log.error(
    { err, ...ctx, attempts: attempts + 1 },
    giveUp ? 'transfer failed for good' : 'transfer step failed; will retry',
  );
  return giveUp ? 'failed' : 'retry_later';
}

/**
 * Background sweep (every 5 minutes): finishes whatever didn't happen at the moment it should
 * have (Razorpay down, a crash): missing transfers, holds to release, refunds to reverse.
 */
export async function sweepTransfers(db: Db, gateway: PaymentGateway, now: Date, log: Log) {
  const [missing, toRelease, toReverse] = await Promise.all([
    db.execute(sql`
      select o.id from orders o
      join stalls s on s.id = o.stall_id and s.razorpay_account_id is not null
      join payments p on p.order_id = o.id and p.status = 'captured'
      left join transfers t on t.order_id = o.id
      where o.payment_method = 'upi' and o.placed_at is not null
        and not exists (select 1 from refunds r where r.order_id = o.id)
        and (t.id is null or (t.status = 'created' and t.provider_transfer_id is null))
      order by o.placed_at limit 50`),
    db.execute(sql`
      select t.order_id as id from transfers t join orders o on o.id = t.order_id
      where t.status = 'on_hold' and o.status = 'collected'
        and not exists (select 1 from refunds r where r.order_id = o.id)
      limit 50`),
    db.execute(sql`
      select t.order_id as id from transfers t
      where t.status in ('created', 'on_hold', 'released')
        and exists (select 1 from refunds r where r.order_id = t.order_id)
      limit 50`),
  ]);
  const ids = (r: { rows: unknown[] }) => (r.rows as Array<{ id: string }>).map((x) => x.id);
  const counts = { created: 0, released: 0, reversed: 0 };
  for (const id of ids(missing))
    if ((await ensureTransfer(db, gateway, id, log)) === 'done') counts.created++;
  for (const id of ids(toReverse))
    if ((await reverseTransfer(db, gateway, id, now, log)) === 'done') counts.reversed++;
  for (const id of ids(toRelease))
    if ((await releaseTransfer(db, gateway, id, now, log)) === 'done') counts.released++;
  return counts;
}

/** Webhook: Razorpay reports a transfer processed or failed (transfer.processed / transfer.failed). */
export async function onTransferWebhook(
  db: Db,
  event: 'transfer.processed' | 'transfer.failed',
  entity: { id: string; error?: { description?: string; reason?: string } | null },
  log: Log,
) {
  const [t] = await db.select().from(transfers).where(eq(transfers.providerTransferId, entity.id));
  if (!t) {
    log.warn({ transferId: entity.id, event }, 'webhook for a transfer we have no record of');
    return;
  }
  if (event === 'transfer.failed' && t.status !== 'reversed') {
    await db
      .update(transfers)
      .set({
        status: 'failed',
        lastError: `razorpay: ${entity.error?.description ?? entity.error?.reason ?? 'failed'}`.slice(0, 500),
      })
      .where(eq(transfers.id, t.id));
    log.error({ orderId: t.orderId, transferId: entity.id }, 'Razorpay reports the transfer failed');
  }
}
