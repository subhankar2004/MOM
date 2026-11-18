import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { orderItems, orders, stalls } from '../../db/schema/index.js';

const ACTIVE = ['pending_payment', 'placed', 'preparing', 'ready'] as const;

export interface OrderSummary {
  id: string;
  stall: { slug: string; name: string };
  status: (typeof orders.$inferSelect)['status'];
  paymentMethod: (typeof orders.$inferSelect)['paymentMethod'];
  paymentStatus: (typeof orders.$inferSelect)['paymentStatus'];
  tokenNo: number | null;
  totalPaise: number;
  itemCount: number;
  /** "2 × Masala Dosa, 1 × Idli" */
  itemsPreview: string;
  createdAt: Date;
}

/**
 * The student's orders (spec §6.1 S7): `active` = everything still in progress (newest first),
 * `past` = finished ones, newest first, keyset-paginated: `before` is the last order id of the
 * previous page, compared as (created_at, id) so ties and microseconds never skip a row.
 */
export async function listOrdersForUser(
  db: Db,
  userId: string,
  scope: 'active' | 'past',
  page: { before?: string; limit: number },
): Promise<{ orders: OrderSummary[]; nextBefore: string | null }> {
  const filters = [
    eq(orders.userId, userId),
    scope === 'active' ? inArray(orders.status, [...ACTIVE]) : notInArray(orders.status, [...ACTIVE]),
  ];
  if (scope === 'past' && page.before) {
    filters.push(
      sql`(${orders.createdAt}, ${orders.id}) < (select o.created_at, o.id from ${orders} o where o.id = ${page.before} and o.user_id = ${userId})`,
    );
  }
  const rows = await db
    .select({
      id: orders.id,
      stall: { slug: stalls.slug, name: stalls.name },
      status: orders.status,
      paymentMethod: orders.paymentMethod,
      paymentStatus: orders.paymentStatus,
      tokenNo: orders.tokenNo,
      totalPaise: orders.totalPaise,
      createdAt: orders.createdAt,
      itemCount: sql<number>`(select coalesce(sum(${orderItems.quantity}), 0)::int from ${orderItems} where ${orderItems.orderId} = ${orders.id})`,
      itemsPreview: sql<string>`(select string_agg(${orderItems.quantity} || ' × ' || ${orderItems.nameSnapshot}, ', ' order by ${orderItems.id}) from ${orderItems} where ${orderItems.orderId} = ${orders.id})`,
    })
    .from(orders)
    .innerJoin(stalls, eq(stalls.id, orders.stallId))
    .where(and(...filters))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(scope === 'past' ? page.limit + 1 : 50);

  const hasMore = scope === 'past' && rows.length > page.limit;
  const list = hasMore ? rows.slice(0, page.limit) : rows;
  return {
    orders: list.map((r) => ({ ...r, itemsPreview: r.itemsPreview ?? '' })),
    nextBefore: hasMore ? list[list.length - 1]!.id : null,
  };
}
