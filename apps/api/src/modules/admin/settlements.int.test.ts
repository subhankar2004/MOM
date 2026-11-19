import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditLog,
  transfers,
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
import type { FakeGateway } from '../payments/gateway.js';

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
  const act = (orderId: string, action: string, body?: object, cookies = vendor.cookies) =>
    app.app.inject({
      method: 'POST',
      url: `/v1/vendor/stalls/${stall.id}/orders/${orderId}/${action}`,
      cookies,
      ...(body ? { payload: body } : {}),
    });
  const staff = await cookiesFor('vendor_staff');
  await app.db.insert(stallMembers).values({ stallId: stall.id, userId: staff.id, role: 'staff' });
  const admin = await cookiesFor('super_admin');
  const call = (method: 'GET' | 'POST', url: string, payload?: object, cookies = admin.cookies) =>
    app.app.inject({ method, url: `/v1/admin${url}`, cookies, payload });
  const gateway = app.app.paymentGateway as FakeGateway;
  return { app, stall, otherStall, student, vendor, staff, admin, place, pay, act, call, gateway };
}

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** The stall has a Razorpay linked account, so UPI orders pay it out through Route. */
async function routeWorld() {
  const w = await world();
  await w.app.db
    .update(stalls)
    .set({ razorpayAccountId: 'acc_teststall01' })
    .where(eq(stalls.id, w.stall.id));
  const transferOf = async (orderId: string) =>
    (await w.app.db.select().from(transfers).where(eq(transfers.orderId, orderId)))[0];
  const atRazorpay = (id: string | null | undefined) => (id ? w.gateway.transfers.get(id) : undefined);
  return { ...w, transferOf, atRazorpay };
}

describe('Route transfers (acceptance: handing over releases the transfer)', () => {
  it('a paid UPI order creates a held transfer of the subtotal; hand-over releases it', async () => {
    const w = await routeWorld();
    const o = await w.place('upi');
    await w.pay(o.id);
    const held = await w.transferOf(o.id);
    expect(held).toMatchObject({ status: 'on_hold', amountPaise: 12000, stallId: w.stall.id });
    expect(w.atRazorpay(held!.providerTransferId)).toMatchObject({
      account: 'acc_teststall01',
      amountPaise: 12000, // ₹120 food; MOM keeps the ₹1.20 platform fee
      orderId: o.id,
      onHold: true,
    });

    expect((await w.act(o.id, 'handover', {})).statusCode).toBe(200);
    const released = await w.transferOf(o.id);
    expect(released).toMatchObject({ status: 'released' });
    expect(released!.releasedAt).not.toBeNull();
    expect(w.atRazorpay(released!.providerTransferId)!.onHold).toBe(false);

    // The stall's sales report counts it as received.
    const report = (
      await w.app.app.inject({ url: `/v1/vendor/stalls/${w.stall.id}/reports`, cookies: w.vendor.cookies })
    ).json();
    expect(report.payouts).toEqual({ upiDuePaise: 12000, transfersReceivedPaise: 12000 });
  });

  it('a refund reverses the transfer, so the money never leaves the stall', async () => {
    const w = await routeWorld();
    const o = await w.place('upi');
    await w.pay(o.id);
    await w.act(o.id, 'reject', { reason: 'Out of batter' });
    const t = await w.transferOf(o.id);
    expect(t).toMatchObject({ status: 'reversed' });
    expect(w.atRazorpay(t!.providerTransferId)!.reversed).toBe(12000);
    // Nothing to release later.
    expect(
      (await w.call('POST', '/reconciliation/run', { days: 1 }))
        .json()
        .run.issues.filter((i: { orderId: string }) => i.orderId === o.id),
    ).toEqual([]);
  });

  it('stalls without a linked account get no transfer (cash-only or test-mode stalls)', async () => {
    const w = await world();
    const o = await w.place('upi');
    await w.pay(o.id);
    expect(await w.app.db.select().from(transfers).where(eq(transfers.orderId, o.id))).toEqual([]);
  });
});

describe('Route transfers: failures and retries', () => {
  it('if Razorpay is down the payment still confirms; the sweep creates the transfer later', async () => {
    const w = await routeWorld();
    const o = await w.place('upi');
    w.gateway.failNext = 'Razorpay unreachable';
    // failNext hits listTransfers inside ensureTransfer, after the payment itself was confirmed.
    await w.pay(o.id);
    expect(
      (await w.app.app.inject({ url: `/v1/orders/${o.id}`, cookies: w.student.cookies })).json().order.status,
    ).toBe('placed');
    expect(await w.transferOf(o.id)).toMatchObject({
      status: 'created',
      attempts: 1,
      providerTransferId: null,
    });
    expect((await w.transferOf(o.id))!.lastError).toMatch(/Razorpay unreachable/);

    const { sweepTransfers } = await import('../finance/transfers.service.js');
    const log = { info() {}, warn() {}, error() {} };
    expect(await sweepTransfers(w.app.db, w.gateway, new Date(), log)).toMatchObject({ created: 1 });
    expect(await w.transferOf(o.id)).toMatchObject({ status: 'on_hold' });
  });

  it('a lost Razorpay response never pays the stall twice', async () => {
    const w = await routeWorld();
    const o = await w.place('upi');
    await w.pay(o.id);
    const t = (await w.transferOf(o.id))!;
    // Pretend our record of the Razorpay transfer was lost after it was created.
    await w.app.db
      .update(transfers)
      .set({ providerTransferId: null, status: 'created' })
      .where(eq(transfers.id, t.id));
    const { ensureTransfer } = await import('../finance/transfers.service.js');
    await ensureTransfer(w.app.db, w.gateway, o.id, { info() {}, warn() {}, error() {} });
    expect(w.gateway.transfers.size).toBe(1);
    expect((await w.transferOf(o.id))!.providerTransferId).toBe(t.providerTransferId);
  });

  it('a failed transfer (webhook) is flagged by the money check and can be retried', async () => {
    const w = await routeWorld();
    const o = await w.place('upi');
    await w.pay(o.id);
    await w.act(o.id, 'handover', {});
    const t = (await w.transferOf(o.id))!;
    const { onTransferWebhook } = await import('../finance/transfers.service.js');
    await onTransferWebhook(
      w.app.db,
      'transfer.failed',
      { id: t.providerTransferId!, error: { description: 'Insufficient balance' } },
      { info() {}, warn() {}, error() {} },
    );
    expect(await w.transferOf(o.id)).toMatchObject({ status: 'failed' });

    const { run } = (await w.call('POST', '/reconciliation/run', { days: 1 })).json();
    expect(run.issues.find((i: { orderId: string }) => i.orderId === o.id)).toMatchObject({
      kind: 'transfer_failed',
    });

    const retried = await w.call('POST', `/orders/${o.id}/transfer/retry`);
    expect(retried.json().transfer).toEqual({ status: 'released', lastError: null });
  });
});

describe('cash settlements and statements (acceptance: balances to ₹0.00 after settlement)', () => {
  it('statement lists fees, adjustments and the settlement; closing balance ₹0.00', async () => {
    const w = await world();
    for (let i = 0; i < 2; i++) {
      const c = await w.place('cash');
      await w.act(c.id, 'handover', { cashReceived: true });
    }
    // MOM credits the stall ₹2.00 for a mistake.
    await w.call('POST', '/ledger/adjustments', {
      stallId: w.stall.id,
      direction: 'debit',
      amountPaise: 200,
      note: 'Wrong price fixed',
    });

    const day = today();
    const before = (await w.call('GET', `/stalls/${w.stall.id}/statement?from=${day}&to=${day}`)).json();
    expect(before.openingPaise).toBe(0);
    expect(before.lines.map((l: { kind: string; amountPaise: number }) => [l.kind, l.amountPaise])).toEqual([
      ['cash_order_fees', 720],
      ['cash_order_fees', 720],
      ['adjustment', -200],
    ]);
    expect(before.closingPaise).toBe(1240);
    const balances = (await w.call('GET', '/settlements')).json().stalls;
    expect(balances.find((s: { stallId: string }) => s.stallId === w.stall.id).owedPaise).toBe(1240);

    // Too much is refused; the exact amount settles it.
    const tooMuch = await w.call('POST', `/stalls/${w.stall.id}/settlements`, {
      amountPaise: 1241,
      periodStart: day,
      periodEnd: day,
    });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json().error.message).toMatch(/₹12\.40/);
    const paid = await w.call('POST', `/stalls/${w.stall.id}/settlements`, {
      amountPaise: 1240,
      periodStart: day,
      periodEnd: day,
      note: 'Cash handed to MOM at the stall',
    });
    expect(paid.statusCode).toBe(201);
    expect(paid.json().owedPaise).toBe(0);

    const after = (await w.call('GET', `/stalls/${w.stall.id}/statement?from=${day}&to=${day}`)).json();
    expect(after.lines.at(-1)).toMatchObject({ kind: 'settlement', amountPaise: -1240, balancePaise: 0 });
    expect(after.closingPaise).toBe(0);
    expect(after.totals).toEqual({ feesPaise: 1440, adjustmentsPaise: -200, settledPaise: 1240 });
    expect(after.settlements).toHaveLength(1);
    expect(
      (
        await w.call('POST', `/stalls/${w.stall.id}/settlements`, {
          amountPaise: 1,
          periodStart: day,
          periodEnd: day,
        })
      ).json().error.message,
    ).toBe('This stall owes nothing right now.');

    // The stall owner sees the same statement; counter staff don't.
    const mine = await w.app.app.inject({
      url: `/v1/vendor/stalls/${w.stall.id}/statement?from=${day}&to=${day}`,
      cookies: w.vendor.cookies,
    });
    expect(mine.json().closingPaise).toBe(0);
    expect(
      (
        await w.app.app.inject({
          url: `/v1/vendor/stalls/${w.stall.id}/statement?from=${day}&to=${day}`,
          cookies: w.staff.cookies,
        })
      ).statusCode,
    ).toBe(403);

    const audits = await w.app.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'stall.cash_settlement'), eq(auditLog.entityId, w.stall.id)));
    expect(audits).toHaveLength(1);
  });

  it('defaults to last week and checks the dates', async () => {
    const w = await world();
    const res = (await w.call('GET', `/stalls/${w.stall.id}/statement`)).json();
    const from = new Date(`${res.period.from}T00:00:00Z`);
    expect(from.getUTCDay()).toBe(1); // a Monday
    expect((new Date(`${res.period.to}T00:00:00Z`).getTime() - from.getTime()) / 86_400_000).toBe(6);
    expect(
      (await w.call('GET', `/stalls/${w.stall.id}/statement?from=2026-05-02&to=2026-05-01`)).statusCode,
    ).toBe(400);
    expect(
      (
        await w.call('POST', `/stalls/${w.stall.id}/settlements`, {
          amountPaise: 100,
          periodStart: '2026-05-02',
          periodEnd: '2026-05-01',
        })
      ).statusCode,
    ).toBe(400);
    expect((await w.call('GET', '/settlements', undefined, w.vendor.cookies)).statusCode).toBe(403);
  });
});
