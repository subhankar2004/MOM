import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ledgerEntries,
  menuCategories,
  menuItems,
  platformSettings,
  stallMembers,
  stalls,
  users,
} from '../../db/schema/index.js';
import { createTestApp, testEnv, type TestApp } from '../../test/test-app.js';
import { ACCESS_COOKIE } from '../auth/cookies.js';
import { signAccessToken, type Role } from '../auth/tokens.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

let seq = 0;
const phone = () => `+9193${String(10_000_000 + ++seq).slice(-8)}`;

async function world() {
  const app = (t = await createTestApp({}, { now: () => new Date() }));
  await app.db.insert(platformSettings).values({
    platformFeeBps: 100,
    cashFeeBps: 500,
    maxOpenCashOrders: 20,
    cashStrikeLimit: 3,
    orderExpiryMinutes: 15,
    congestionLowMaxMinutes: 10,
    congestionModerateMaxMinutes: 20,
  });
  const mkStall = async (slug: string) =>
    (
      await app.db
        .insert(stalls)
        .values({
          slug: `${slug.toLowerCase().replace(/ /g, '-')}-${++seq}`,
          name: slug,
          status: 'active',
          isOpenOverride: true,
          upiEnabled: true,
          routeStatus: 'activated',
        })
        .returning()
    )[0]!;
  const stall = await mkStall('Board Stall');
  const otherStall = await mkStall('Other Stall');
  const [cat] = await app.db.insert(menuCategories).values({ stallId: stall.id, name: 'Food' }).returning();
  const [dosa] = await app.db
    .insert(menuItems)
    .values({ stallId: stall.id, categoryId: cat!.id, name: 'Masala Dosa', pricePaise: 6000, isVeg: true })
    .returning();

  const cookiesFor = async (role: Role, stallId?: string) => {
    const [u] = await app.db.insert(users).values({ phone: phone(), name: role, role }).returning();
    if (stallId) await app.db.insert(stallMembers).values({ stallId, userId: u!.id, role: 'owner' });
    const { token } = await signAccessToken(testEnv().JWT_SECRET, { userId: u!.id, role }, 900);
    return { id: u!.id, cookies: { [ACCESS_COOKIE]: token } };
  };
  const student = await cookiesFor('student');
  const vendor = await cookiesFor('vendor_owner', stall.id);
  const outsider = await cookiesFor('vendor_owner', otherStall.id);

  const place = async (method: 'cash' | 'upi' = 'cash', note?: string) => {
    const res = await app.app.inject({
      method: 'POST',
      url: '/v1/orders',
      cookies: student.cookies,
      headers: { 'idempotency-key': `board-key-${++seq}-abc` },
      payload: {
        stallId: stall.id,
        items: [{ itemId: dosa!.id, quantity: 2 }],
        paymentMethod: method,
        expectedTotalPaise: method === 'cash' ? 12720 : 12120,
        note,
      },
    });
    return res.json().order as { id: string; tokenNo: number | null };
  };
  const pay = async (orderId: string) => {
    const start = await app.app.inject({
      method: 'POST',
      url: '/v1/payments/razorpay/order',
      cookies: student.cookies,
      payload: { orderId },
    });
    const rzp = start.json().razorpayOrderId as string;
    const paymentId = `pay_${++seq}`;
    await app.app.inject({
      method: 'POST',
      url: '/v1/payments/razorpay/verify',
      cookies: student.cookies,
      payload: {
        orderId,
        razorpayOrderId: rzp,
        razorpayPaymentId: paymentId,
        razorpaySignature: createHmac('sha256', testEnv().RAZORPAY_KEY_SECRET!)
          .update(`${rzp}|${paymentId}`)
          .digest('hex'),
      },
    });
    return paymentId;
  };
  const board = (cookies = vendor.cookies, stallId = stall.id) =>
    app.app.inject({ url: `/v1/vendor/stalls/${stallId}/orders`, cookies });
  const act = (orderId: string, action: string, body?: object, cookies = vendor.cookies) =>
    app.app.inject({
      method: 'POST',
      url: `/v1/vendor/stalls/${stall.id}/orders/${orderId}/${action}`,
      cookies,
      ...(body ? { payload: body } : {}),
    });
  const staff = await cookiesFor('vendor_staff');
  await app.db.insert(stallMembers).values({ stallId: stall.id, userId: staff.id, role: 'staff' });
  const report = (query: string, cookies = vendor.cookies, stallId = stall.id) =>
    app.app.inject({ url: `/v1/vendor/stalls/${stallId}/reports${query}`, cookies });
  return { app, stall, otherStall, student, vendor, outsider, staff, place, pay, board, act, report };
}

/** India date `offset` days from today, YYYY-MM-DD. */
const istDate = (offset = 0) =>
  new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);

/** Signed ledger sums for the stall between two instants, straight from the table. */
async function ledgerSums(db: TestApp['db'], stallId: string, from: string, to: string) {
  const res = await db.execute(sql`
    select
      coalesce(sum(case when direction = 'credit' then amount_paise else -amount_paise end)
        filter (where entry_type <> 'settlement'), 0)::int as net,
      coalesce(sum(amount_paise) filter (where entry_type = 'platform_fee'), 0)::int as platform,
      coalesce(sum(amount_paise) filter (where entry_type = 'cash_fee'), 0)::int as cash_fee,
      coalesce(sum(amount_paise) filter (where entry_type = 'refund_reversal'), 0)::int as refunded
    from ledger_entries
    where stall_id = ${stallId}
      and created_at >= ${new Date(`${from}T00:00:00+05:30`)}
      and created_at < ${new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000)}`);
  return res.rows[0] as { net: number; platform: number; cash_fee: number; refunded: number };
}

describe('GET /v1/vendor/stalls/:stallId/reports', () => {
  it('totals equal the ledger for the period, with sales, dues and a daily breakdown', async () => {
    const w = await world();
    // Two UPI orders handed over, one rejected (refunded); two cash orders handed over.
    const u1 = await w.place('upi');
    await w.pay(u1.id);
    const u2 = await w.place('upi');
    await w.pay(u2.id);
    const u3 = await w.place('upi');
    await w.pay(u3.id);
    for (const id of [u1.id, u2.id]) await w.act(id, 'handover', {});
    await w.act(u3.id, 'reject', { reason: 'Out of batter' });
    const c1 = await w.place('cash');
    const c2 = await w.place('cash');
    for (const id of [c1.id, c2.id]) await w.act(id, 'handover', { cashReceived: true });
    // A cash order not yet collected: no fees, no sales.
    await w.place('cash');

    // The stall paid MOM ₹5 of its cash dues; MOM credited the stall ₹1 (adjustment).
    await w.app.db.insert(ledgerEntries).values([
      { stallId: w.stall.id, entryType: 'settlement', direction: 'debit', amountPaise: 500 },
      {
        stallId: w.stall.id,
        entryType: 'adjustment',
        direction: 'debit',
        amountPaise: 100,
        note: 'goodwill',
      },
      // Outside the period, and another stall: must not count.
      {
        stallId: w.stall.id,
        orderId: c1.id,
        entryType: 'cash_fee',
        direction: 'credit',
        amountPaise: 999,
        createdAt: new Date(Date.now() - 10 * 86_400_000),
      },
      { stallId: w.otherStall.id, entryType: 'adjustment', direction: 'credit', amountPaise: 777 },
    ]);

    const from = istDate(-1);
    const to = istDate(1);
    const res = await w.report(`?from=${from}&to=${to}`);
    expect(res.statusCode).toBe(200);
    const r = res.json();

    // Acceptance: the report's money equals the ledger for the period.
    const raw = await ledgerSums(w.app.db, w.stall.id, from, to);
    expect(r.fees).toMatchObject({
      platformFeesPaise: raw.platform,
      cashFeesPaise: raw.cash_fee,
      refundedPaise: raw.refunded,
      netPaise: raw.net,
    });
    // ₹120 subtotal each: UPI fee 120 × 3 paid (one later reversed), cash 120 + 600 × 2.
    expect(r.fees).toEqual({
      platformFeesPaise: 120 * 5,
      cashFeesPaise: 600 * 2,
      refundedPaise: 120,
      adjustmentsPaise: -100,
      netPaise: 120 * 5 + 1200 - 120 - 100,
    });
    expect(r.orders).toEqual({ collected: 4, upi: 2, cash: 2, rejected: 1, cancelled: 0 });
    expect(r.sales).toEqual({
      grossPaise: 48000,
      upiPaise: 24000,
      cashPaise: 24000,
      cashTakenPaise: 2 * 12720,
    });
    // Cash dues: 2 × (₹1.20 + ₹6.00) owed, ₹5 paid back; outstanding also includes the old
    // ₹9.99 entry and the −₹1 adjustment.
    expect(r.dues).toEqual({ owedPaise: 1440, settledPaise: 500, outstandingPaise: 1440 + 999 - 500 - 100 });
    expect(r.payouts).toEqual({ upiDuePaise: 24000, transfersReceivedPaise: null });

    expect(r.daily.map((d: { day: string }) => d.day)).toEqual([from, istDate(0), to]);
    const sum = (k: string) => r.daily.reduce((s: number, d: Record<string, number>) => s + d[k]!, 0);
    expect(sum('grossPaise')).toBe(r.sales.grossPaise);
    expect(sum('orders')).toBe(r.orders.collected);
    expect(sum('feesPaise')).toBe(r.fees.netPaise);
  });

  it('defaults to today and is empty for a quiet stall', async () => {
    const w = await world();
    const r = (await w.report('')).json();
    expect(r.period).toEqual({ from: istDate(0), to: istDate(0) });
    expect(r.orders.collected).toBe(0);
    expect(r.fees.netPaise).toBe(0);
    expect(r.daily).toHaveLength(1);
  });

  it('is for the stall owner only, and checks the dates', async () => {
    const w = await world();
    expect((await w.report('', w.staff.cookies)).statusCode).toBe(403);
    expect((await w.report('', w.outsider.cookies)).statusCode).toBe(403);
    expect((await w.report('', w.student.cookies)).statusCode).toBe(403);
    expect((await w.report('?from=2026-11-10&to=2026-11-01')).statusCode).toBe(400);
    expect((await w.report('?from=2026-01-01&to=2026-12-31')).statusCode).toBe(400);
    expect((await w.report('?from=2026-02-30&to=2026-03-01')).statusCode).toBe(400);
    expect((await w.report('?from=yesterday')).statusCode).toBe(400);
  });
});
