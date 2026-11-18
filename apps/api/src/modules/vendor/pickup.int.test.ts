import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditLog,
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
import { pickupQrPayload } from '../orders/pickup-qr.js';

const NOON = new Date('2026-11-18T12:00:00+05:30');
let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

let seq = 0;
const phone = () => `+9193${String(10_000_000 + ++seq).slice(-8)}`;

async function world() {
  const app = (t = await createTestApp({}, { now: () => NOON }));
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
  /** What the student's phone shows: token, pickup code, QR. */
  const mine = async (orderId: string) =>
    (await app.app.inject({ url: `/v1/orders/${orderId}`, cookies: student.cookies })).json().order as {
      tokenNo: number;
      pickupCode: string;
      pickupQr: string | null;
      status: string;
      paymentStatus: string;
    };
  const verify = (payload: object, cookies = vendor.cookies, stallId = stall.id) =>
    app.app.inject({ method: 'POST', url: `/v1/vendor/stalls/${stallId}/pickup/verify`, cookies, payload });
  const staff = await cookiesFor('vendor_staff');
  await app.db.insert(stallMembers).values({ stallId: stall.id, userId: staff.id, role: 'staff' });
  return { app, stall, otherStall, student, vendor, outsider, staff, place, pay, board, act, mine, verify };
}

describe('POST /v1/vendor/stalls/:stallId/pickup/verify', () => {
  it('accepts a ready order from its QR, and counter staff may scan', async () => {
    const w = await world();
    const o = await w.place('upi');
    await w.pay(o.id);
    await w.act(o.id, 'ready');
    const { pickupQr } = await w.mine(o.id);
    for (const cookies of [w.vendor.cookies, w.staff.cookies]) {
      const res = await w.verify({ qr: pickupQr }, cookies);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        valid: true,
        warning: null,
        cashDuePaise: 0,
        order: { id: o.id, status: 'ready', items: [{ name: 'Masala Dosa', quantity: 2 }] },
      });
    }
  });

  it('warns when the order is not ready yet, and says how much cash to collect', async () => {
    const w = await world();
    const o = await w.place('cash');
    const { pickupQr } = await w.mine(o.id);
    const res = (await w.verify({ qr: pickupQr })).json();
    expect(res).toMatchObject({ valid: true, warning: 'not_ready', cashDuePaise: 12720 });
  });

  it('checks token + pickup code, and treats a wrong code like an unknown order', async () => {
    const w = await world();
    const o = await w.place('cash');
    const { tokenNo, pickupCode } = await w.mine(o.id);
    const ok = (await w.verify({ tokenNo, pickupCode })).json();
    expect(ok).toMatchObject({ valid: true, order: { id: o.id } });
    const wrongCode = pickupCode === '0000' ? '1111' : '0000';
    const bad = (await w.verify({ tokenNo, pickupCode: wrongCode })).json();
    expect(bad).toMatchObject({ valid: false, reason: 'unknown', order: null });
    expect((await w.verify({ tokenNo: 999, pickupCode })).json().reason).toBe('unknown');
    expect((await w.verify({ tokenNo, pickupCode: '12' })).statusCode).toBe(400);
  });

  it("rejects another stall's QR without revealing the order", async () => {
    const w = await world();
    const o = await w.place('cash');
    const { pickupQr } = await w.mine(o.id);
    // The outsider owns the other stall and scans this stall's student's code at their counter.
    const res = (await w.verify({ qr: pickupQr }, w.outsider.cookies, w.otherStall.id)).json();
    expect(res).toEqual({
      valid: false,
      reason: 'wrong_stall',
      message: 'This order is for another stall.',
      order: null,
    });
    // ...and can't check it against this stall either.
    expect((await w.verify({ qr: pickupQr }, w.outsider.cookies)).statusCode).toBe(403);
  });

  it('refuses forged, garbled and unpaid codes', async () => {
    const w = await world();
    const o = await w.place('cash');
    const { pickupQr } = await w.mine(o.id);
    const forged = pickupQr!.slice(0, -2) + (pickupQr!.endsWith('AA') ? 'BB' : 'AA');
    expect((await w.verify({ qr: forged })).json().reason).toBe('unknown');
    expect((await w.verify({ qr: 'https://example.com' })).json().reason).toBe('unknown');

    // An unpaid UPI order has no QR for the student, but a signed id would still be refused.
    const unpaid = await w.place('upi');
    const qr = pickupQrPayload(testEnv().QR_SECRET, unpaid.id);
    expect((await w.verify({ qr })).json()).toMatchObject({ valid: false, reason: 'not_paid' });
  });

  it('says a rejected order was rejected', async () => {
    const w = await world();
    const o = await w.place('cash');
    const { pickupQr } = await w.mine(o.id);
    await w.act(o.id, 'reject', { reason: 'Out of batter' });
    expect((await w.verify({ qr: pickupQr })).json()).toMatchObject({
      valid: false,
      reason: 'cancelled',
      message: 'This order was rejected.',
    });
  });
});

describe('POST /v1/vendor/stalls/:stallId/orders/:orderId/handover', () => {
  it('hands over a paid UPI order; scanning again says already collected', async () => {
    const w = await world();
    const o = await w.place('upi');
    await w.pay(o.id);
    await w.act(o.id, 'ready');
    const { pickupQr } = await w.mine(o.id);
    const res = await w.act(o.id, 'handover', {});
    expect(res.statusCode).toBe(200);
    expect(res.json().order).toMatchObject({ status: 'collected', paymentStatus: 'paid' });
    expect(await w.mine(o.id)).toMatchObject({ status: 'collected', pickupQr: null });

    const again = (await w.verify({ qr: pickupQr })).json();
    expect(again).toMatchObject({ valid: false, reason: 'already_collected' });
    expect(again.message).toMatch(/^Already collected at /);
    expect((await w.act(o.id, 'handover', {})).statusCode).toBe(409);

    const audits = await w.app.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, o.id), eq(auditLog.action, 'order.handover')));
    expect(audits).toHaveLength(1);
    // The board moves it to "finished today".
    const board = (await w.board()).json();
    expect(board.finishedToday.map((x: { id: string }) => x.id)).toContain(o.id);
  });

  it('needs the cash first; then records paid_cash and MOM fees in the ledger', async () => {
    const w = await world();
    const o = await w.place('cash');
    const refused = await w.act(o.id, 'handover', {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      message: 'Collect the cash before handing over.',
      details: { cashDuePaise: 12720 },
    });
    const [before] = await w.app.db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, o.id));
    expect(before).toBeUndefined();

    const res = await w.act(o.id, 'handover', { cashReceived: true }, w.staff.cookies);
    expect(res.json().order).toMatchObject({ status: 'collected', paymentStatus: 'paid_cash' });
    const ledger = await w.app.db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, o.id));
    // ₹120 subtotal: 1% platform fee ₹1.20, 5% cash fee ₹6.00.
    expect(ledger.map((l) => [l.entryType, l.amountPaise, l.direction]).sort()).toEqual([
      ['cash_fee', 600, 'credit'],
      ['platform_fee', 120, 'credit'],
    ]);
  });

  it("can't hand over another stall's, a rejected or an unpaid order", async () => {
    const w = await world();
    const o = await w.place('cash');
    const asOutsider = await w.app.app.inject({
      method: 'POST',
      url: `/v1/vendor/stalls/${w.otherStall.id}/orders/${o.id}/handover`,
      cookies: w.outsider.cookies,
      payload: { cashReceived: true },
    });
    expect(asOutsider.statusCode).toBe(404);
    await w.act(o.id, 'reject', { reason: 'Out of batter' });
    expect((await w.act(o.id, 'handover', { cashReceived: true })).statusCode).toBe(409);
    const unpaid = await w.place('upi');
    expect((await w.act(unpaid.id, 'handover', {})).statusCode).toBe(404);
  });
});
