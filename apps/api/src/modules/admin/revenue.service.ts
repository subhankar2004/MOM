import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { badRequest } from '../../lib/errors.js';
import { recentRuns } from '../finance/reconcile.service.js';
import { istDay } from '../orders/orders.service.js';
import type { StallsService } from '../stalls/stalls.service.js';

const MS_PER_DAY = 86_400_000;
const istStart = (day: string) => new Date(`${day}T00:00:00+05:30`);
const n = (v: unknown) => Number(v ?? 0);

/** Signed ledger amount: credit = MOM earns (+), debit = MOM gives back (−). */
const SIGNED = sql.raw(`case when l.direction = 'credit' then l.amount_paise else -l.amount_paise end`);

export type Grouping = 'day' | 'week' | 'month';

/**
 * Admin overview and revenue (spec §6.3 A1, A2). Money MOM earns comes only from the
 * append-only ledger; order counts and order value come from the orders.
 */
export class RevenueService {
  constructor(
    private readonly db: Db,
    private readonly stalls: StallsService,
  ) {}

  /** Today (India time) at a glance, plus what needs attention. */
  async overview(now: Date) {
    const start = istStart(istDay(now));
    const end = new Date(start.getTime() + MS_PER_DAY);
    const [orders, money, live, failed, attention, stallCounts, publicStalls, runs] = await Promise.all([
      this.db.execute(sql`
        select count(*)::int as orders,
          count(*) filter (where status = 'collected')::int as collected,
          coalesce(sum(total_paise) filter (where status not in ('rejected', 'cancelled')), 0)::bigint as value,
          count(*) filter (where payment_method = 'upi')::int as upi,
          count(*) filter (where payment_method = 'cash')::int as cash
        from orders where placed_at >= ${start} and placed_at < ${end}`),
      this.db.execute(sql`
        select coalesce(sum(${SIGNED}) filter (where l.entry_type <> 'settlement'), 0)::bigint as net
        from ledger_entries l where l.created_at >= ${start} and l.created_at < ${end}`),
      this.db.execute(sql`
        select count(*) filter (where status = 'placed')::int as placed,
          count(*) filter (where status = 'preparing')::int as preparing,
          count(*) filter (where status = 'ready')::int as ready
        from orders where status in ('placed', 'preparing', 'ready')`),
      this.db.execute(sql`
        select count(*)::int as n from payments where status = 'failed' and created_at >= ${start} and created_at < ${end}`),
      this.db.execute(sql`
        select count(*) filter (where payment_status = 'refund_pending')::int as refund_pending
        from orders where payment_status = 'refund_pending'`),
      this.db.execute(sql`
        select count(*) filter (where status = 'active')::int as active,
          count(*) filter (where status = 'draft')::int as draft,
          count(*) filter (where route_status = 'pending')::int as payouts_in_review
        from stalls`),
      this.stalls.list(),
      recentRuns(this.db, 1),
    ]);
    const o = orders.rows[0] as Record<string, unknown>;
    const l = live.rows[0] as Record<string, unknown>;
    const s = stallCounts.rows[0] as Record<string, unknown>;
    const last = runs[0] ?? null;
    return {
      day: istDay(now),
      today: {
        orders: n(o.orders),
        collected: n(o.collected),
        upiOrders: n(o.upi),
        cashOrders: n(o.cash),
        orderValuePaise: n(o.value),
        revenuePaise: n((money.rows[0] as Record<string, unknown>).net),
        failedPayments: n((failed.rows[0] as Record<string, unknown>).n),
      },
      live: { placed: n(l.placed), preparing: n(l.preparing), ready: n(l.ready) },
      stalls: {
        active: n(s.active),
        openNow: publicStalls.filter((p) => p.availability.state === 'open').length,
        draft: n(s.draft),
        payoutsInReview: n(s.payouts_in_review),
      },
      attention: { refundPending: n((attention.rows[0] as Record<string, unknown>).refund_pending) },
      reconciliation: last
        ? {
            ranAt: last.ranAt,
            status: last.status,
            errors: last.issues.filter((i) => i.severity === 'error').length,
            warnings: last.issues.filter((i) => i.severity === 'warning').length,
          }
        : null,
    };
  }

  /** Revenue for India dates from–to (inclusive), grouped by day, week (Mon) or month. */
  async revenue(input: { from: string; to: string; group: Grouping }) {
    if (!['day', 'week', 'month'].includes(input.group)) throw badRequest('Group by day, week or month');
    const start = istStart(input.from);
    const endDay = istStart(input.to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(endDay.getTime())) throw badRequest('Not a real date');
    if (endDay < start) throw badRequest('"from" must be on or before "to"');
    if ((endDay.getTime() - start.getTime()) / MS_PER_DAY > 366)
      throw badRequest('Choose at most a year at a time');
    const end = new Date(endDay.getTime() + MS_PER_DAY);
    const unit = sql.raw(`'${input.group}'`); // one of three fixed words, validated by the route
    const bucket = (col: string) =>
      sql.raw(`date_trunc('${input.group}', (${col} at time zone 'Asia/Kolkata'))::date`);

    const [totals, series, ledgerByStall, ordersByStall, mix] = await Promise.all([
      this.db.execute(sql`
        select
          coalesce(sum(l.amount_paise) filter (where l.entry_type = 'platform_fee' and l.direction = 'credit'), 0)::bigint as platform,
          coalesce(sum(l.amount_paise) filter (where l.entry_type = 'cash_fee' and l.direction = 'credit'), 0)::bigint as cash,
          coalesce(sum(l.amount_paise) filter (where l.entry_type = 'refund_reversal'), 0)::bigint as refunded,
          coalesce(sum(${SIGNED}) filter (where l.entry_type = 'adjustment'), 0)::bigint as adjustments,
          coalesce(sum(${SIGNED}) filter (where l.entry_type <> 'settlement'), 0)::bigint as net
        from ledger_entries l where l.created_at >= ${start} and l.created_at < ${end}`),
      // Every bucket in the range, with zeros where nothing happened.
      this.db.execute(sql`
        with buckets as (
          select generate_series(date_trunc(${unit}, ${input.from}::date), ${input.to}::date, ('1 ' || ${input.group})::interval)::date as bucket
        ), money as (
          select ${bucket('l.created_at')} as bucket,
            sum(l.amount_paise) filter (where l.entry_type = 'platform_fee' and l.direction = 'credit') as platform,
            sum(l.amount_paise) filter (where l.entry_type = 'cash_fee' and l.direction = 'credit') as cash,
            sum(${SIGNED}) filter (where l.entry_type <> 'settlement') as net
          from ledger_entries l where l.created_at >= ${start} and l.created_at < ${end}
          group by 1
        )
        select b.bucket::text as bucket, coalesce(m.platform, 0)::bigint as platform,
          coalesce(m.cash, 0)::bigint as cash, coalesce(m.net, 0)::bigint as net
        from buckets b left join money m on m.bucket = b.bucket order by b.bucket`),
      this.db.execute(sql`
        select l.stall_id,
          coalesce(sum(l.amount_paise) filter (where l.entry_type = 'platform_fee' and l.direction = 'credit'), 0)::bigint as platform,
          coalesce(sum(l.amount_paise) filter (where l.entry_type = 'cash_fee' and l.direction = 'credit'), 0)::bigint as cash,
          coalesce(sum(l.amount_paise) filter (where l.entry_type = 'refund_reversal'), 0)::bigint as refunded,
          coalesce(sum(${SIGNED}) filter (where l.entry_type <> 'settlement'), 0)::bigint as net
        from ledger_entries l where l.created_at >= ${start} and l.created_at < ${end}
        group by l.stall_id`),
      this.db.execute(sql`
        select stall_id, count(*)::int as orders, coalesce(sum(total_paise), 0)::bigint as value
        from orders where status = 'collected' and closed_at >= ${start} and closed_at < ${end}
        group by stall_id`),
      this.db.execute(sql`
        select payment_method, count(*)::int as orders, coalesce(sum(total_paise), 0)::bigint as value
        from orders where status = 'collected' and closed_at >= ${start} and closed_at < ${end}
        group by payment_method`),
    ]);

    const stallIds = new Set([
      ...ledgerByStall.rows.map((r) => String((r as { stall_id: string }).stall_id)),
      ...ordersByStall.rows.map((r) => String((r as { stall_id: string }).stall_id)),
    ]);
    const names = new Map<string, string>();
    if (stallIds.size > 0) {
      const rows = await this.db.execute(
        sql`select id, name from stalls where id in (${sql.join(
          [...stallIds].map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
      for (const r of rows.rows as Array<{ id: string; name: string }>) names.set(r.id, r.name);
    }
    const money = new Map(
      ledgerByStall.rows.map((r) => [
        String((r as { stall_id: string }).stall_id),
        r as Record<string, unknown>,
      ]),
    );
    const sold = new Map(
      ordersByStall.rows.map((r) => [
        String((r as { stall_id: string }).stall_id),
        r as Record<string, unknown>,
      ]),
    );
    const byStall = [...stallIds]
      .map((id) => {
        const m = money.get(id);
        const o = sold.get(id);
        return {
          stallId: id,
          stallName: names.get(id) ?? 'Unknown stall',
          orders: n(o?.orders),
          orderValuePaise: n(o?.value),
          platformFeesPaise: n(m?.platform),
          cashFeesPaise: n(m?.cash),
          refundedPaise: n(m?.refunded),
          netPaise: n(m?.net),
        };
      })
      .sort((a, b) => b.netPaise - a.netPaise || a.stallName.localeCompare(b.stallName));

    const t = totals.rows[0] as Record<string, unknown>;
    const mixOf = (method: 'upi' | 'cash') => {
      const r = (mix.rows as Array<Record<string, unknown>>).find((x) => x.payment_method === method);
      return { orders: n(r?.orders), valuePaise: n(r?.value) };
    };
    return {
      period: { from: input.from, to: input.to, group: input.group },
      totals: {
        platformFeesPaise: n(t.platform),
        cashFeesPaise: n(t.cash),
        refundedPaise: n(t.refunded),
        adjustmentsPaise: n(t.adjustments),
        netPaise: n(t.net),
      },
      series: (series.rows as Array<Record<string, unknown>>).map((r) => ({
        bucket: String(r.bucket),
        platformFeesPaise: n(r.platform),
        cashFeesPaise: n(r.cash),
        netPaise: n(r.net),
      })),
      byStall,
      mix: { upi: mixOf('upi'), cash: mixOf('cash') },
    };
  }
}
