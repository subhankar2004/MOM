import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
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
  const app = (t = await createTestApp({ PAYMENTS_PROVIDER: 'test' }, { now: () => new Date() }));
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
  return { app, stall, otherStall, student, vendor, admin, place, pay, act, call, gateway };
}

describe('test payment mode (PAYMENTS_PROVIDER=test)', () => {
  it('"paying" completes at once: no Razorpay window, token issued', async () => {
    const w = await world();
    const o = await w.place('upi');
    const start = await w.app.app.inject({
      method: 'POST',
      url: '/v1/payments/razorpay/order',
      cookies: w.student.cookies,
      payload: { orderId: o.id },
    });
    expect(start.json()).toMatchObject({ testMode: true, orderId: o.id });
    const done = await w.app.app.inject({
      method: 'POST',
      url: '/v1/payments/test/complete',
      cookies: w.student.cookies,
      payload: { orderId: o.id, razorpayOrderId: start.json().razorpayOrderId },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().order).toMatchObject({
      status: 'placed',
      paymentStatus: 'paid',
      tokenNo: expect.any(Number),
    });
  });

  it("can't complete someone else's order or a made-up payment", async () => {
    const w = await world();
    const o = await w.place('upi');
    const start = (
      await w.app.app.inject({
        method: 'POST',
        url: '/v1/payments/razorpay/order',
        cookies: w.student.cookies,
        payload: { orderId: o.id },
      })
    ).json();
    const other = await w.app.app.inject({
      method: 'POST',
      url: '/v1/payments/test/complete',
      cookies: w.vendor.cookies,
      payload: { orderId: o.id, razorpayOrderId: start.razorpayOrderId },
    });
    expect(other.statusCode).toBe(404);
    const madeUp = await w.app.app.inject({
      method: 'POST',
      url: '/v1/payments/test/complete',
      cookies: w.student.cookies,
      payload: { orderId: o.id, razorpayOrderId: 'order_madeup123' },
    });
    expect(madeUp.statusCode).toBe(400);
  });

  it('does not exist with the real Razorpay gateway or the automated-test gateway', async () => {
    for (const provider of ['razorpay', 'fake']) {
      const app = await createTestApp({ PAYMENTS_PROVIDER: provider });
      const res = await app.app.inject({ method: 'POST', url: '/v1/payments/test/complete', payload: {} });
      expect(res.statusCode).toBe(404);
      await app.close();
    }
  });

  it('is refused on staging and production', () => {
    expect(() => testEnv({ NODE_ENV: 'staging', PAYMENTS_PROVIDER: 'test' })).toThrow(/local testing only/);
  });
});
