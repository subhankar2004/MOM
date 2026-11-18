import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ledgerEntries,
  menuCategories,
  menuItems,
  orders,
  payments,
  platformSettings,
  refunds,
  stalls,
  users,
  webhookEvents,
} from '../../db/schema/index.js';
import { createTestApp, testEnv, type TestApp } from '../../test/test-app.js';
import { ACCESS_COOKIE } from '../auth/cookies.js';
import { signAccessToken } from '../auth/tokens.js';
import type { FakeGateway } from './gateway.js';
import { expireUnpaidOrders, refundOrder } from './payments.service.js';

const NOON = new Date('2026-11-16T12:00:00+05:30');
const env = testEnv();
const KEY_SECRET = env.RAZORPAY_KEY_SECRET!;
const WEBHOOK_SECRET = env.RAZORPAY_WEBHOOK_SECRET!;
const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

let seq = 0;
async function student(app: TestApp) {
  const [u] = await app.db
    .insert(users)
    .values({ phone: `+9193${String(10_000_000 + ++seq).slice(-8)}`, name: 'Payer' })
    .returning();
  const { token } = await signAccessToken(env.JWT_SECRET, { userId: u!.id, role: 'student' }, 900);
  return { user: u!, cookies: { [ACCESS_COOKIE]: token } };
}

/** An open UPI stall, a student, and a ₹130 UPI order (₹131.30 to pay). */
async function world(envOverrides: Record<string, string> = {}) {
  const app = (t = await createTestApp(envOverrides, { now: () => NOON }));
  await app.db.insert(platformSettings).values({
    platformFeeBps: 100,
    cashFeeBps: 500,
    maxOpenCashOrders: 2,
    cashStrikeLimit: 3,
    orderExpiryMinutes: 15,
    congestionLowMaxMinutes: 10,
    congestionModerateMaxMinutes: 20,
  });
  const [stall] = await app.db
    .insert(stalls)
    .values({
      slug: `pay-${++seq}`,
      name: 'Pay Stall',
      status: 'active',
      isOpenOverride: true,
      upiEnabled: true,
      routeStatus: 'activated',
    })
    .returning();
  const [cat] = await app.db.insert(menuCategories).values({ stallId: stall!.id, name: 'Food' }).returning();
  const [item] = await app.db
    .insert(menuItems)
    .values({ stallId: stall!.id, categoryId: cat!.id, name: 'Thali', pricePaise: 13000, isVeg: true })
    .returning();
  const me = await student(app);
  const placeUpi = async (method: 'upi' | 'cash' = 'upi') =>
    app.app.inject({
      method: 'POST',
      url: '/v1/orders',
      cookies: me.cookies,
      headers: { 'idempotency-key': `pay-key-${++seq}-xyz` },
      payload: {
        stallId: stall!.id,
        items: [{ itemId: item!.id, quantity: 1 }],
        paymentMethod: method,
        expectedTotalPaise: method === 'upi' ? 13130 : 13780,
      },
    });
  const startPay = (orderId: string, cookies = me.cookies) =>
    app.app.inject({ method: 'POST', url: '/v1/payments/razorpay/order', cookies, payload: { orderId } });
  const verify = (
    orderId: string,
    razorpayOrderId: string,
    paymentId: string,
    signature?: string,
    cookies = me.cookies,
  ) =>
    app.app.inject({
      method: 'POST',
      url: '/v1/payments/razorpay/verify',
      cookies,
      payload: {
        orderId,
        razorpayOrderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: signature ?? hmac(KEY_SECRET, `${razorpayOrderId}|${paymentId}`),
      },
    });
  const webhook = (
    event: string,
    razorpayOrderId: string,
    paymentId: string,
    opts: { amount?: number; eventId?: string; secret?: string } = {},
  ) => {
    const body = JSON.stringify({
      event,
      created_at: 1_794_900_000,
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: razorpayOrderId,
            amount: opts.amount ?? 13130,
            status: 'captured',
          },
        },
      },
    });
    return app.app.inject({
      method: 'POST',
      url: '/v1/webhooks/razorpay',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': hmac(opts.secret ?? WEBHOOK_SECRET, body),
        'x-razorpay-event-id': opts.eventId ?? `evt_${++seq}`,
      },
      payload: body,
    });
  };
  const getOrder = async (id: string) => (await app.db.select().from(orders).where(eq(orders.id, id)))[0]!;
  return { app, me, stall: stall!, placeUpi, startPay, verify, webhook, getOrder };
}

describe('paying by UPI', () => {
  it('start → Razorpay order (reused on a second tap) → verified payment → token + ledger', async () => {
    const w = await world();
    const orderId = (await w.placeUpi()).json().order.id;

    const start = await w.startPay(orderId);
    expect(start.statusCode).toBe(200);
    expect(start.json()).toMatchObject({
      keyId: 'rzp_test_fakekey123',
      amountPaise: 13130,
      currency: 'INR',
      orderId,
    });
    const rzpOrder = start.json().razorpayOrderId as string;
    expect(rzpOrder).toMatch(/^order_fake/);
    expect((await w.startPay(orderId)).json().razorpayOrderId).toBe(rzpOrder); // no duplicate Razorpay order

    const res = await w.verify(orderId, rzpOrder, 'pay_TEST1');
    expect(res.statusCode).toBe(200);
    expect(res.json().order).toMatchObject({
      status: 'placed',
      paymentStatus: 'paid',
      tokenNo: 1,
      expiresAt: null,
    });

    const ledger = await w.app.db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, orderId));
    expect(ledger.map((e) => [e.entryType, e.direction, e.amountPaise])).toEqual([
      ['platform_fee', 'credit', 130],
    ]);
    const [p] = await w.app.db.select().from(payments).where(eq(payments.orderId, orderId));
    expect(p).toMatchObject({ status: 'captured', providerPaymentId: 'pay_TEST1', amountPaise: 13130 });
  });

  it('verifying twice changes nothing (one token, one set of ledger entries)', async () => {
    const w = await world();
    const orderId = (await w.placeUpi()).json().order.id;
    const rzp = (await w.startPay(orderId)).json().razorpayOrderId;
    await w.verify(orderId, rzp, 'pay_A');
    const again = await w.verify(orderId, rzp, 'pay_A');
    expect(again.json().order.tokenNo).toBe(1);
    expect(
      await w.app.db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, orderId)),
    ).toHaveLength(1);
  });

  it('a forged signature is refused and the order stays unpaid', async () => {
    const w = await world();
    const orderId = (await w.placeUpi()).json().order.id;
    const rzp = (await w.startPay(orderId)).json().razorpayOrderId;
    const res = await w.verify(orderId, rzp, 'pay_X', hmac('not-the-secret', `${rzp}|pay_X`));
    expect([res.statusCode, res.json().error.code]).toEqual([400, 'BAD_REQUEST']);
    expect((await w.getOrder(orderId)).status).toBe('pending_payment');
  });

  it("can't pay for, or confirm a payment onto, someone else's order", async () => {
    const w = await world();
    const orderId = (await w.placeUpi()).json().order.id;
    const rzp = (await w.startPay(orderId)).json().razorpayOrderId;
    const other = await student(w.app);
    expect((await w.startPay(orderId, other.cookies)).statusCode).toBe(404);
    expect((await w.verify(orderId, rzp, 'pay_Z', undefined, other.cookies)).statusCode).toBe(404);
    expect((await w.getOrder(orderId)).status).toBe('pending_payment');
  });

  it('cash orders and already-paid orders cannot start a UPI payment', async () => {
    const w = await world();
    const cash = (await w.placeUpi('cash')).json().order.id;
    expect((await w.startPay(cash)).json().error.message).toMatch(/cash/);
    const upi = (await w.placeUpi()).json().order.id;
    const rzp = (await w.startPay(upi)).json().razorpayOrderId;
    await w.verify(upi, rzp, 'pay_B');
    expect((await w.startPay(upi)).json().error.message).toMatch(/already paid/);
  });
});

describe('webhook (the student closed the browser after paying)', () => {
  it('payment.captured issues the token; a duplicate delivery changes nothing', async () => {
    const w = await world();
    const orderId = (await w.placeUpi()).json().order.id;
    const rzp = (await w.startPay(orderId)).json().razorpayOrderId;

    const first = await w.webhook('payment.captured', rzp, 'pay_WH1', { eventId: 'evt_same' });
    expect([first.statusCode, first.json().status]).toEqual([200, 'ok']);
    expect(await w.getOrder(orderId)).toMatchObject({ status: 'placed', paymentStatus: 'paid', tokenNo: 1 });

    const dup = await w.webhook('payment.captured', rzp, 'pay_WH1', { eventId: 'evt_same' });
    expect(dup.json().status).toBe('duplicate');
    // order.paid for the same payment (a different event) is also harmless
    expect((await w.webhook('order.paid', rzp, 'pay_WH1')).statusCode).toBe(200);
    expect((await w.getOrder(orderId)).tokenNo).toBe(1);
    expect(
      await w.app.db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, orderId)),
    ).toHaveLength(1);

    // and the browser's verify arriving late is a no-op too
    expect((await w.verify(orderId, rzp, 'pay_WH1')).json().order.tokenNo).toBe(1);
  });

  it('rejects a bad signature and ignores events for unknown orders', async () => {
    const w = await world();
    expect((await w.webhook('payment.captured', 'order_x', 'pay_x', { secret: 'wrong' })).statusCode).toBe(
      401,
    );
    const unknown = await w.webhook('payment.captured', 'order_not_ours', 'pay_y');
    expect([unknown.statusCode, unknown.json().status]).toEqual([200, 'ignored']);
    const [stored] = await w.app.db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.error, 'unknown order'));
    expect(stored?.processedAt).toBeInstanceOf(Date);
  });

  it('a wrong amount is refused (Razorpay will retry) and nothing is confirmed', async () => {
    const w = await world();
    const orderId = (await w.placeUpi()).json().order.id;
    const rzp = (await w.startPay(orderId)).json().razorpayOrderId;
    expect((await w.webhook('payment.captured', rzp, 'pay_W', { amount: 100 })).statusCode).toBe(400);
    expect((await w.getOrder(orderId)).status).toBe('pending_payment');
  });

  it('payment.failed marks the attempt failed; the student can retry', async () => {
    const w = await world();
    const orderId = (await w.placeUpi()).json().order.id;
    const rzp = (await w.startPay(orderId)).json().razorpayOrderId;
    await w.webhook('payment.failed', rzp, 'pay_F');
    const [p] = await w.app.db.select().from(payments).where(eq(payments.providerOrderId, rzp));
    expect(p!.status).toBe('failed');
    const retry = await w.startPay(orderId);
    expect(retry.json().razorpayOrderId).not.toBe(rzp); // a fresh attempt
  });
});

describe('expiry and refunds', () => {
  it('unpaid orders expire after 15 minutes and can no longer be paid', async () => {
    const w = await world();
    const orderId = (await w.placeUpi()).json().order.id;
    expect(await expireUnpaidOrders(w.app.db, new Date(NOON.getTime() + 14 * 60_000))).toBe(0);
    expect(await expireUnpaidOrders(w.app.db, new Date(NOON.getTime() + 15 * 60_000))).toBe(1);
    expect(await w.getOrder(orderId)).toMatchObject({ status: 'expired', paymentStatus: 'failed' });
    expect((await w.startPay(orderId)).statusCode).toBe(409);
  });

  it('a payment that arrives after expiry is refunded automatically', async () => {
    const w = await world();
    const orderId = (await w.placeUpi()).json().order.id;
    const rzp = (await w.startPay(orderId)).json().razorpayOrderId;
    await expireUnpaidOrders(w.app.db, new Date(NOON.getTime() + 16 * 60_000));

    const res = await w.webhook('payment.captured', rzp, 'pay_LATE');
    expect(res.statusCode).toBe(200);
    expect(await w.getOrder(orderId)).toMatchObject({
      status: 'expired',
      paymentStatus: 'refunded',
      tokenNo: null,
    });
    const gw = w.app.app.paymentGateway as FakeGateway;
    expect(gw.refunds).toEqual([{ paymentId: 'pay_LATE', amountPaise: 13130, notes: expect.any(Object) }]);
    const [r] = await w.app.db.select().from(refunds).where(eq(refunds.orderId, orderId));
    expect(r).toMatchObject({
      amountPaise: 13130,
      status: 'processed',
      reason: 'Paid after the order expired',
    });
    // MOM never earned anything on it
    expect(await w.app.db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, orderId))).toEqual([]);
  });

  it("refunding a paid order reverses MOM's fee in the ledger, once", async () => {
    const w = await world();
    const orderId = (await w.placeUpi()).json().order.id;
    const rzp = (await w.startPay(orderId)).json().razorpayOrderId;
    await w.verify(orderId, rzp, 'pay_R');
    const gw = w.app.app.paymentGateway!;
    const log = { info() {}, warn() {}, error() {} };

    const first = await refundOrder(
      w.app.db,
      gw,
      { orderId, reason: 'Stall ran out of thali', actorId: null },
      log,
    );
    const second = await refundOrder(w.app.db, gw, { orderId, reason: 'again', actorId: null }, log);
    expect(second!.refundId).toBe(first!.refundId);

    const ledger = await w.app.db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, orderId));
    expect(ledger.map((e) => [e.entryType, e.direction, e.amountPaise]).sort()).toEqual([
      ['platform_fee', 'credit', 130],
      ['refund_reversal', 'debit', 130],
    ]);
    expect((await w.getOrder(orderId)).paymentStatus).toBe('refunded');
  });
});

describe('without Razorpay keys', () => {
  it('UPI is simply not offered: no payment routes, no UPI in the bill, UPI orders refused', async () => {
    const w = await world({ RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', RAZORPAY_WEBHOOK_SECRET: '' });
    expect((await w.placeUpi()).json().error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    expect((await w.startPay('0190a000-0000-7000-8000-000000000000')).statusCode).toBe(404);
    const quote = await w.app.app.inject({
      method: 'POST',
      url: '/v1/cart/quote',
      payload: { stallId: w.stall.id, items: [] },
    });
    expect(quote.json().options.upi).toBeNull();
  });
});
