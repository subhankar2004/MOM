import { desc, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { reconciliationRuns } from '../../db/schema/index.js';

export type IssueKind =
  | 'ledger_mismatch'
  | 'payment_missing'
  | 'payment_amount'
  | 'payment_not_reflected'
  | 'cash_state'
  | 'ledger_wrong_stall'
  | 'refund_stuck';

export interface ReconciliationIssue {
  kind: IssueKind;
  /** error = money records disagree; warning = needs a look (e.g. a refund waiting a day). */
  severity: 'error' | 'warning';
  orderId: string;
  message: string;
  expectedPaise?: number;
  actualPaise?: number;
}

interface Log {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

const MS_PER_DAY = 86_400_000;

/**
 * What MOM should have earned on an order, by its facts (spec §4.1–4.4):
 *  - UPI: the platform fee once the payment confirmed the order, back to 0 once refunded;
 *  - cash: platform + cash fee once the cash was received at hand-over;
 *  - anything else: 0.
 */
const EXPECTED = sql.raw(`
  case
    when o.payment_method = 'upi' then
      case when o.placed_at is not null and not exists (select 1 from refunds r where r.order_id = o.id)
           then o.platform_fee_paise else 0 end
    when o.payment_status = 'paid_cash' then o.platform_fee_paise + o.cash_fee_paise
    else 0
  end`);

/**
 * Nightly reconciliation (spec §4.4): for every order created in the window, compares the
 * ledger, the order and its Razorpay payment records, and stores the result. Any error is
 * logged at error level ("reconciliation mismatch") for the alarm (#28) and shown on the
 * admin overview. Read-only apart from the stored run.
 */
export async function reconcile(
  db: Db,
  input: { now: Date; days: number; startedBy: string | null },
  log: Log,
) {
  const periodEnd = input.now;
  const periodStart = new Date(input.now.getTime() - input.days * MS_PER_DAY);
  const issues: ReconciliationIssue[] = [];
  const add = (
    rows: Array<Record<string, unknown>>,
    make: (r: Record<string, unknown>) => ReconciliationIssue,
  ) => rows.forEach((r) => issues.push(make(r)));
  const inWindow = sql`o.created_at >= ${periodStart} and o.created_at < ${periodEnd}`;

  const [counted, ledger, missingPayment, wrongAmount, notReflected, cashState, wrongStall, stuck] =
    await Promise.all([
      db.execute(sql`select count(*)::int as n from orders o where ${inWindow}`),
      // 1. Ledger (fees, minus reversals) must equal what the order says MOM earned.
      db.execute(sql`
        select o.id, (${EXPECTED})::int as expected,
          coalesce((select sum(case when l.direction = 'credit' then l.amount_paise else -l.amount_paise end)
                    from ledger_entries l
                    where l.order_id = o.id and l.entry_type in ('platform_fee', 'cash_fee', 'refund_reversal')), 0)::int as actual
        from orders o where ${inWindow}`),
      // 2. A confirmed UPI order must have a captured Razorpay payment...
      db.execute(sql`
        select o.id from orders o
        where ${inWindow} and o.payment_method = 'upi' and o.placed_at is not null
          and not exists (select 1 from payments p where p.order_id = o.id and p.status = 'captured')`),
      // 3. ...for exactly the order total.
      db.execute(sql`
        select o.id, o.total_paise as expected, p.amount_paise as actual from orders o
        join payments p on p.order_id = o.id and p.status = 'captured'
        where ${inWindow} and p.amount_paise <> o.total_paise`),
      // 4. Money Razorpay captured must show on the order (paid, or being refunded).
      db.execute(sql`
        select o.id, o.payment_status from orders o
        join payments p on p.order_id = o.id and p.status = 'captured'
        where ${inWindow} and o.payment_status not in ('paid', 'refund_pending', 'refunded')`),
      // 5. Cash is only received at hand-over.
      db.execute(sql`
        select o.id, o.status from orders o
        where ${inWindow} and o.payment_status = 'paid_cash' and o.status <> 'collected'`),
      // 6. Each ledger row belongs to its order's stall (stall statements depend on it).
      db.execute(sql`
        select distinct o.id from orders o join ledger_entries l on l.order_id = o.id
        where ${inWindow} and l.stall_id <> o.stall_id`),
      // 7. A refund that couldn't start a day ago needs an admin (retry in the orders explorer).
      db.execute(sql`
        select o.id from orders o
        where ${inWindow} and o.payment_status = 'refund_pending'
          and not exists (select 1 from refunds r where r.order_id = o.id)
          and o.updated_at < ${new Date(input.now.getTime() - MS_PER_DAY)}`),
    ]);

  add(
    (ledger.rows as Array<{ id: string; expected: number; actual: number }>).filter(
      (r) => r.expected !== r.actual,
    ),
    (r) => ({
      kind: 'ledger_mismatch',
      severity: 'error',
      orderId: String(r.id),
      message: `Ledger shows ₹${(Number(r.actual) / 100).toFixed(2)} earned; the order says ₹${(Number(r.expected) / 100).toFixed(2)}.`,
      expectedPaise: Number(r.expected),
      actualPaise: Number(r.actual),
    }),
  );
  add(missingPayment.rows as Array<Record<string, unknown>>, (r) => ({
    kind: 'payment_missing',
    severity: 'error',
    orderId: String(r.id),
    message: 'Confirmed UPI order without a captured Razorpay payment.',
  }));
  add(wrongAmount.rows as Array<Record<string, unknown>>, (r) => ({
    kind: 'payment_amount',
    severity: 'error',
    orderId: String(r.id),
    message: 'Razorpay captured a different amount than the order total.',
    expectedPaise: Number(r.expected),
    actualPaise: Number(r.actual),
  }));
  add(notReflected.rows as Array<Record<string, unknown>>, (r) => ({
    kind: 'payment_not_reflected',
    severity: 'error',
    orderId: String(r.id),
    message: `Razorpay captured money but the order's payment is "${String(r.payment_status)}".`,
  }));
  add(cashState.rows as Array<Record<string, unknown>>, (r) => ({
    kind: 'cash_state',
    severity: 'error',
    orderId: String(r.id),
    message: `Cash marked paid but the order is "${String(r.status)}", not collected.`,
  }));
  add(wrongStall.rows as Array<Record<string, unknown>>, (r) => ({
    kind: 'ledger_wrong_stall',
    severity: 'error',
    orderId: String(r.id),
    message: "A ledger entry is booked to a different stall than the order's.",
  }));
  add(stuck.rows as Array<Record<string, unknown>>, (r) => ({
    kind: 'refund_stuck',
    severity: 'warning',
    orderId: String(r.id),
    message: "Refund couldn't start for over a day. Retry it from the order.",
  }));

  const errors = issues.filter((i) => i.severity === 'error').length;
  const status = errors > 0 ? ('mismatch' as const) : ('ok' as const);
  const ordersChecked = Number((counted.rows[0] as { n: number }).n);
  const [run] = await db
    .insert(reconciliationRuns)
    .values({ periodStart, periodEnd, ordersChecked, status, issues, startedBy: input.startedBy })
    .returning();
  if (status === 'mismatch') {
    // The alarm (#28) watches for this message.
    log.error({ runId: run!.id, errors, issues: issues.slice(0, 20) }, 'reconciliation mismatch');
  } else {
    log.info({ runId: run!.id, ordersChecked, warnings: issues.length }, 'reconciliation ok');
  }
  return toRun(run!);
}

export async function recentRuns(db: Db, limit = 10) {
  const rows = await db
    .select()
    .from(reconciliationRuns)
    .orderBy(desc(reconciliationRuns.createdAt), desc(reconciliationRuns.id))
    .limit(limit);
  return rows.map(toRun);
}

function toRun(r: typeof reconciliationRuns.$inferSelect) {
  return {
    id: r.id,
    ranAt: r.createdAt,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    ordersChecked: r.ordersChecked,
    status: r.status as 'ok' | 'mismatch',
    issues: r.issues as ReconciliationIssue[],
    startedBy: r.startedBy,
  };
}
