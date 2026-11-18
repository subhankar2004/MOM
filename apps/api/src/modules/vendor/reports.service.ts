import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { badRequest } from '../../lib/errors.js';

/** Inclusive range of India dates, e.g. 2026-11-01 … 2026-11-30. */
export interface Period {
  from: string;
  to: string;
}

export interface DayRow {
  day: string;
  orders: number;
  grossPaise: number;
  upiPaise: number;
  cashPaise: number;
  /** MOM's fees recorded that day (ledger, net of reversals). */
  feesPaise: number;
}

export interface StallReport {
  period: Period;
  orders: { collected: number; upi: number; cash: number; rejected: number; cancelled: number };
  /** The stall's food sales (order subtotals) for orders collected in the period. */
  sales: { grossPaise: number; upiPaise: number; cashPaise: number; cashTakenPaise: number };
  /** From the ledger only: what MOM earned from this stall's orders in the period. */
  fees: {
    platformFeesPaise: number;
    cashFeesPaise: number;
    refundedPaise: number;
    adjustmentsPaise: number;
    netPaise: number;
  };
  /**
   * Cash orders: the stall holds the student's whole payment and owes MOM the fees (spec §4.3).
   * From the ledger: owed in the period, paid back in the period, and still owed at the end.
   */
  dues: { owedPaise: number; settledPaise: number; outstandingPaise: number };
  /**
   * UPI: Razorpay pays the stall the subtotal (MOM keeps the platform fee). Transfers are tracked
   * from #26; until then `transfersReceivedPaise` is null.
   */
  payouts: { upiDuePaise: number; transfersReceivedPaise: number | null };
  daily: DayRow[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 93;

/** Validates the range and returns its bounds as instants (IST midnights). */
export function periodBounds(period: Period): { start: Date; end: Date; days: number } {
  if (!DAY.test(period.from) || !DAY.test(period.to)) throw badRequest('Dates must be YYYY-MM-DD');
  const start = new Date(`${period.from}T00:00:00+05:30`);
  const endDay = new Date(`${period.to}T00:00:00+05:30`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endDay.getTime())) throw badRequest('Not a real date');
  const days = Math.round((endDay.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days < 1) throw badRequest('"from" must be on or before "to"');
  if (days > MAX_DAYS) throw badRequest('Choose at most 3 months at a time');
  return { start, end: new Date(endDay.getTime() + 86_400_000), days };
}

/** Every India date in the period, in order. */
function daysOf(period: Period, days: number): string[] {
  const first = new Date(`${period.from}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) =>
    new Date(first.getTime() + i * 86_400_000).toISOString().slice(0, 10),
  );
}

const n = (v: unknown) => Number(v ?? 0);

/** Signed ledger amount: credit = MOM earns / is owed (+), debit = MOM gives back / is paid (−). */
const signed = sql.raw(`case when l.direction = 'credit' then l.amount_paise else -l.amount_paise end`);
const istDay = (column: string) => sql.raw(`(${column} at time zone 'Asia/Kolkata')::date`);

/**
 * Sales & dues for one stall (spec §6.2 V8). Money MOM earns or is owed comes only from the
 * append-only ledger (spec §4.4); sales and order counts come from the orders collected in the
 * period, because the ledger records fees, not the food bill.
 */
export async function stallReport(db: Db, stallId: string, period: Period): Promise<StallReport> {
  const { start, end, days } = periodBounds(period);

  const [orderTotals, ledgerTotals, outstanding, orderDays, ledgerDays] = await Promise.all([
    db.execute(sql`
      select
        count(*) filter (where status = 'collected')::int as collected,
        count(*) filter (where status = 'collected' and payment_method = 'upi')::int as upi,
        count(*) filter (where status = 'collected' and payment_method = 'cash')::int as cash,
        count(*) filter (where status = 'rejected')::int as rejected,
        count(*) filter (where status = 'cancelled')::int as cancelled,
        coalesce(sum(subtotal_paise) filter (where status = 'collected'), 0)::bigint as gross,
        coalesce(sum(subtotal_paise) filter (where status = 'collected' and payment_method = 'upi'), 0)::bigint as upi_gross,
        coalesce(sum(subtotal_paise) filter (where status = 'collected' and payment_method = 'cash'), 0)::bigint as cash_gross,
        coalesce(sum(total_paise) filter (where status = 'collected' and payment_method = 'cash'), 0)::bigint as cash_taken
      from orders
      where stall_id = ${stallId} and closed_at >= ${start} and closed_at < ${end}`),
    db.execute(sql`
      select
        coalesce(sum(l.amount_paise) filter (where l.entry_type = 'platform_fee' and l.direction = 'credit'), 0)::bigint as platform,
        coalesce(sum(l.amount_paise) filter (where l.entry_type = 'cash_fee' and l.direction = 'credit'), 0)::bigint as cash_fee,
        coalesce(sum(l.amount_paise) filter (where l.entry_type = 'refund_reversal'), 0)::bigint as refunded,
        coalesce(sum(${signed}) filter (where l.entry_type = 'adjustment'), 0)::bigint as adjustments,
        coalesce(sum(${signed}) filter (where l.entry_type <> 'settlement'), 0)::bigint as net,
        coalesce(sum(${signed}) filter (where o.payment_method = 'cash' and l.entry_type in ('platform_fee', 'cash_fee')), 0)::bigint as owed,
        coalesce(sum(l.amount_paise) filter (where l.entry_type = 'settlement' and l.direction = 'debit'), 0)::bigint as settled
      from ledger_entries l
      left join orders o on o.id = l.order_id
      where l.stall_id = ${stallId} and l.created_at >= ${start} and l.created_at < ${end}`),
    // Still owed at the end of the period: cash-order fees and adjustments, less settlements.
    db.execute(sql`
      select coalesce(sum(${signed}), 0)::bigint as outstanding
      from ledger_entries l
      left join orders o on o.id = l.order_id
      where l.stall_id = ${stallId} and l.created_at < ${end}
        and (l.entry_type in ('settlement', 'adjustment') or o.payment_method = 'cash')`),
    db.execute(sql`
      select ${istDay('closed_at')}::text as day,
        count(*)::int as orders,
        coalesce(sum(subtotal_paise), 0)::bigint as gross,
        coalesce(sum(subtotal_paise) filter (where payment_method = 'upi'), 0)::bigint as upi,
        coalesce(sum(subtotal_paise) filter (where payment_method = 'cash'), 0)::bigint as cash
      from orders
      where stall_id = ${stallId} and status = 'collected' and closed_at >= ${start} and closed_at < ${end}
      group by 1`),
    db.execute(sql`
      select ${istDay('l.created_at')}::text as day, coalesce(sum(${signed}), 0)::bigint as fees
      from ledger_entries l
      where l.stall_id = ${stallId} and l.entry_type <> 'settlement'
        and l.created_at >= ${start} and l.created_at < ${end}
      group by 1`),
  ]);

  const o = orderTotals.rows[0] as Record<string, unknown>;
  const l = ledgerTotals.rows[0] as Record<string, unknown>;
  const byDay = new Map(
    orderDays.rows.map((r) => [String((r as { day: string }).day), r as Record<string, unknown>]),
  );
  const feesByDay = new Map(
    ledgerDays.rows.map((r) => [String((r as { day: string }).day), n((r as { fees: unknown }).fees)]),
  );

  return {
    period,
    orders: {
      collected: n(o.collected),
      upi: n(o.upi),
      cash: n(o.cash),
      rejected: n(o.rejected),
      cancelled: n(o.cancelled),
    },
    sales: {
      grossPaise: n(o.gross),
      upiPaise: n(o.upi_gross),
      cashPaise: n(o.cash_gross),
      cashTakenPaise: n(o.cash_taken),
    },
    fees: {
      platformFeesPaise: n(l.platform),
      cashFeesPaise: n(l.cash_fee),
      refundedPaise: n(l.refunded),
      adjustmentsPaise: n(l.adjustments),
      netPaise: n(l.net),
    },
    dues: {
      owedPaise: n(l.owed),
      settledPaise: n(l.settled),
      outstandingPaise: n((outstanding.rows[0] as { outstanding: unknown }).outstanding),
    },
    payouts: { upiDuePaise: n(o.upi_gross), transfersReceivedPaise: null },
    daily: daysOf(period, days).map((day) => {
      const r = byDay.get(day);
      return {
        day,
        orders: n(r?.orders),
        grossPaise: n(r?.gross),
        upiPaise: n(r?.upi),
        cashPaise: n(r?.cash),
        feesPaise: feesByDay.get(day) ?? 0,
      };
    }),
  };
}
