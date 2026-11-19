import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { cashSettlements, ledgerEntries, stalls } from '../../db/schema/index.js';
import { audit } from '../../lib/audit.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';

const MS_PER_DAY = 86_400_000;
const istStart = (day: string) => new Date(`${day}T00:00:00+05:30`);
const n = (v: unknown) => Number(v ?? 0);

/**
 * Ledger rows that make up what a stall owes MOM (spec §4.3): fees on cash orders (the stall
 * kept the student's whole payment), adjustments, and settlements paid back. Signed: + owed,
 * − paid back or credited. UPI fees aren't owed: MOM keeps them before paying the stall.
 */
const DUES_ROWS = sql.raw(`(l.entry_type in ('settlement', 'adjustment') or o.payment_method = 'cash')`);
const SIGNED = sql.raw(`case when l.direction = 'credit' then l.amount_paise else -l.amount_paise end`);

/** What the stall owes MOM from entries before `before` (all of them when omitted). */
export async function duesBalance(db: Db, stallId: string, before?: Date): Promise<number> {
  const res = await db.execute(sql`
    select coalesce(sum(${SIGNED}), 0)::bigint as owed
    from ledger_entries l left join orders o on o.id = l.order_id
    where l.stall_id = ${stallId} and ${DUES_ROWS}
      ${before ? sql`and l.created_at < ${before}` : sql``}`);
  return n((res.rows[0] as { owed: unknown }).owed);
}

/** Every stall's position: cash dues owed, UPI money held / paid out, problems. */
export async function settlementBalances(db: Db, now: Date) {
  const weekAgo = new Date(now.getTime() - 7 * MS_PER_DAY);
  const res = await db.execute(sql`
    select s.id, s.name, s.status, s.route_status,
      coalesce((select sum(${SIGNED}) from ledger_entries l left join orders o on o.id = l.order_id
                where l.stall_id = s.id and ${DUES_ROWS}), 0)::bigint as owed,
      coalesce((select sum(t.amount_paise) from transfers t where t.stall_id = s.id and t.status = 'on_hold'), 0)::bigint as held,
      (select count(*) from transfers t where t.stall_id = s.id and t.status = 'on_hold')::int as held_count,
      coalesce((select sum(t.amount_paise) from transfers t
                where t.stall_id = s.id and t.status = 'released' and t.released_at >= ${weekAgo}), 0)::bigint as released_week,
      (select count(*) from transfers t where t.stall_id = s.id and (t.status = 'failed' or (t.status = 'created' and t.attempts > 0)))::int as transfer_problems,
      (select max(c.created_at) from cash_settlements c where c.stall_id = s.id) as last_settlement
    from stalls s
    where s.status <> 'draft'
       or exists (select 1 from ledger_entries l where l.stall_id = s.id)
    order by owed desc, s.name`);
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    stallId: String(r.id),
    stallName: String(r.name),
    status: String(r.status) as 'draft' | 'active' | 'suspended',
    routeStatus: String(r.route_status),
    owedPaise: n(r.owed),
    heldPaise: n(r.held),
    heldTransfers: n(r.held_count),
    releasedLast7DaysPaise: n(r.released_week),
    transferProblems: n(r.transfer_problems),
    lastSettlementAt: r.last_settlement ? new Date(String(r.last_settlement)) : null,
  }));
}

/**
 * The stall paid MOM its cash dues (spec A6: "mark a cash settlement received"). Recorded as a
 * cash_settlements row and a ledger 'settlement' debit in one transaction, audited. Can't be
 * more than what's owed, so a statement can't go below ₹0.00 by mistake.
 */
export async function recordCashSettlement(
  db: Db,
  input: {
    stallId: string;
    amountPaise: number;
    periodStart: string;
    periodEnd: string;
    note?: string | null;
    receivedBy: string;
    ip?: string;
    userAgent?: string;
  },
) {
  if (input.periodEnd < input.periodStart) throw badRequest('The period must end on or after it starts');
  return db.transaction(async (tx) => {
    // One settlement at a time per stall: the balance check below must see the latest.
    const [stall] = await tx
      .select({ id: stalls.id, name: stalls.name })
      .from(stalls)
      .where(eq(stalls.id, input.stallId))
      .for('update');
    if (!stall) throw notFound('Stall not found');
    const owed = await duesBalance(tx, input.stallId);
    if (input.amountPaise > owed) {
      throw new AppError(
        409,
        'CONFLICT',
        owed > 0
          ? `That's more than the ₹${(owed / 100).toFixed(2)} this stall owes.`
          : 'This stall owes nothing right now.',
        { owedPaise: owed },
      );
    }
    const [settlement] = await tx
      .insert(cashSettlements)
      .values({
        stallId: input.stallId,
        amountPaise: input.amountPaise,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        receivedBy: input.receivedBy,
        note: input.note || null,
      })
      .returning();
    await tx.insert(ledgerEntries).values({
      stallId: input.stallId,
      entryType: 'settlement',
      direction: 'debit',
      amountPaise: input.amountPaise,
      note: `Cash settlement ${settlement!.id}${input.note ? `: ${input.note}` : ''}`.slice(0, 300),
      createdBy: input.receivedBy,
    });
    await audit(tx, {
      actorId: input.receivedBy,
      action: 'stall.cash_settlement',
      entity: 'stall',
      entityId: input.stallId,
      before: { owedPaise: owed },
      after: {
        settlementId: settlement!.id,
        amountPaise: input.amountPaise,
        owedPaise: owed - input.amountPaise,
      },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { settlement: settlement!, owedPaise: owed - input.amountPaise };
  });
}

export interface StatementLine {
  at: Date;
  kind: 'cash_order_fees' | 'adjustment' | 'settlement';
  description: string;
  /** + adds to what the stall owes, − pays it down. */
  amountPaise: number;
  balancePaise: number;
  orderId: string | null;
}

/**
 * A stall's statement for India dates from–to (spec A6 weekly statements): opening balance,
 * every line that changed what it owes (cash-order fees, adjustments, settlements) with a
 * running balance, closing balance; plus its UPI payouts (Route transfers) in the period.
 */
export async function stallStatement(db: Db, stallId: string, period: { from: string; to: string }) {
  const start = istStart(period.from);
  const endDay = istStart(period.to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endDay.getTime())) throw badRequest('Not a real date');
  if (endDay < start) throw badRequest('"from" must be on or before "to"');
  if ((endDay.getTime() - start.getTime()) / MS_PER_DAY > 366)
    throw badRequest('Choose at most a year at a time');
  const end = new Date(endDay.getTime() + MS_PER_DAY);

  const [stall] = await db
    .select({ id: stalls.id, name: stalls.name })
    .from(stalls)
    .where(eq(stalls.id, stallId));
  if (!stall) throw notFound('Stall not found');

  const [opening, rows, upi, settlementsList] = await Promise.all([
    duesBalance(db, stallId, start),
    // Fees of one cash order are one line (platform + cash fee).
    db.execute(sql`
      select min(l.created_at) as at,
        case when l.entry_type in ('settlement', 'adjustment') then l.entry_type::text else 'cash_order_fees' end as kind,
        l.order_id, o.token_no, o.token_day,
        sum(${SIGNED})::bigint as amount,
        string_agg(distinct l.note, '; ') as note
      from ledger_entries l left join orders o on o.id = l.order_id
      where l.stall_id = ${stallId} and ${DUES_ROWS} and l.created_at >= ${start} and l.created_at < ${end}
      group by 2, l.order_id, o.token_no, o.token_day,
        case when l.entry_type in ('settlement', 'adjustment') then l.id else 0 end
      order by 1, min(l.id)`),
    db.execute(sql`
      select
        coalesce(sum(amount_paise) filter (where created_at >= ${start} and created_at < ${end}), 0)::bigint as created,
        coalesce(sum(amount_paise) filter (where released_at >= ${start} and released_at < ${end}), 0)::bigint as released,
        coalesce(sum(amount_paise) filter (where reversed_at >= ${start} and reversed_at < ${end}), 0)::bigint as reversed,
        coalesce(sum(amount_paise) filter (where status = 'on_hold'), 0)::bigint as held_now,
        count(*) filter (where status = 'failed')::int as failed
      from transfers where stall_id = ${stallId}`),
    db
      .select()
      .from(cashSettlements)
      .where(
        sql`${cashSettlements.stallId} = ${stallId} and ${cashSettlements.createdAt} >= ${start} and ${cashSettlements.createdAt} < ${end}`,
      ),
  ]);

  let balance = opening;
  const lines: StatementLine[] = (rows.rows as Array<Record<string, unknown>>).map((r) => {
    const amount = n(r.amount);
    balance += amount;
    const kind = String(r.kind) as StatementLine['kind'];
    const token = r.token_no ? `token #${r.token_no} (${String(r.token_day)})` : 'an order';
    return {
      at: new Date(String(r.at)),
      kind,
      description:
        kind === 'cash_order_fees'
          ? `MOM fees on cash ${token}`
          : kind === 'settlement'
            ? 'Cash paid to MOM'
            : `Adjustment${r.note ? `: ${String(r.note)}` : ''}`,
      amountPaise: amount,
      balancePaise: balance,
      orderId: r.order_id ? String(r.order_id) : null,
    };
  });
  const u = upi.rows[0] as Record<string, unknown>;
  return {
    stall: { id: stall.id, name: stall.name },
    period,
    openingPaise: opening,
    lines,
    closingPaise: balance,
    totals: {
      feesPaise: lines.filter((l) => l.kind === 'cash_order_fees').reduce((s, l) => s + l.amountPaise, 0),
      adjustmentsPaise: lines.filter((l) => l.kind === 'adjustment').reduce((s, l) => s + l.amountPaise, 0),
      settledPaise: -lines.filter((l) => l.kind === 'settlement').reduce((s, l) => s + l.amountPaise, 0),
    },
    upi: {
      transferredPaise: n(u.created),
      releasedPaise: n(u.released),
      reversedPaise: n(u.reversed),
      heldNowPaise: n(u.held_now),
      failedTransfers: n(u.failed),
    },
    settlements: settlementsList.map((s) => ({
      id: s.id,
      amountPaise: s.amountPaise,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      note: s.note,
      createdAt: s.createdAt,
    })),
  };
}
