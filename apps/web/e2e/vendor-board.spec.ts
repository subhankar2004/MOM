import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { addMenu, addStallMember, createTestStall, createUser } from './support/db';
import { API_URL, E2E_RAZORPAY_SECRET, PHONES, WEB_URL } from './support/env';
import { signIn } from './support/session';

/**
 * The counter board, with a real student ordering from another browser:
 * new orders arrive live with a chime, and Accept → Mark ready reaches the student.
 */
test.describe.configure({ mode: 'serial' });

const project = () => test.info().project.name.replace(/[^a-z0-9]/g, '');
const headers = { origin: WEB_URL };

let stallId: string;
let student: APIRequestContext;
let dosaId: string;
const stateFile = () => `e2e/.auth/board-${test.info().project.name}.json`;
test.beforeEach(async ({ context }) => {
  const state = JSON.parse(readFileSync(stateFile(), 'utf8')) as {
    cookies: Parameters<typeof context.addCookies>[0];
  };
  await context.addCookies(state.cookies);
  await context.addInitScript(() => localStorage.setItem('mom.session', '1'));
});

test.beforeAll(async ({ browser }) => {
  const slug = `e2e-board-${project()}`;
  stallId = await createTestStall(slug, { open: true, upi: true });
  await addMenu(stallId, [['Tiffin', [['Masala Dosa', 60]]]]);
  // Its own stall owner, so other tests' expectations about the shared vendor aren't disturbed.
  const owner = project() === 'desktop' ? PHONES.boardVendorDesktop : PHONES.boardVendor360;
  await createUser(owner, 'Board Owner', 'vendor_owner');
  await addStallMember(stallId, owner);
  const ownerCtx = await browser.newContext();
  await signIn(ownerCtx, owner, 'Board Owner');
  await ownerCtx.storageState({ path: stateFile() });
  await ownerCtx.close();
  const ctx = await browser.newContext();
  await signIn(ctx, project() === 'desktop' ? PHONES.boardDesktop : PHONES.boardPhone360, 'Board Student');
  student = ctx.request;
  const menu = await (await student.get(`${API_URL}/v1/stalls/${slug}/menu`)).json();
  dosaId = menu.categories[0].items[0].id;
});

/** The student orders over the API (as their phone would) and gets the order back. */
async function studentOrders(method: 'cash' | 'upi', note?: string) {
  const items = [{ itemId: dosaId, quantity: 2 }];
  // 2 × ₹60 = ₹120 + 1% platform fee (+ 5% cash fee): ₹121.20 by UPI, ₹127.20 in cash.
  const expectedTotalPaise = method === 'cash' ? 12720 : 12120;
  const res = await student.post(`${API_URL}/v1/orders`, {
    headers: { ...headers, 'idempotency-key': `board-${project()}-${Date.now()}-${Math.random()}` },
    data: {
      stallId,
      items,
      paymentMethod: method,
      expectedTotalPaise,
      note,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const order = (await res.json()).order as { id: string; tokenNo: number | null };
  if (method === 'upi') {
    const start = await (
      await student.post(`${API_URL}/v1/payments/razorpay/order`, { data: { orderId: order.id }, headers })
    ).json();
    const paymentId = `pay_board_${Date.now()}`;
    const verified = await student.post(`${API_URL}/v1/payments/razorpay/verify`, {
      headers,
      data: {
        orderId: order.id,
        razorpayOrderId: start.razorpayOrderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: createHmac('sha256', E2E_RAZORPAY_SECRET)
          .update(`${start.razorpayOrderId}|${paymentId}`)
          .digest('hex'),
      },
    });
    expect(verified.ok(), await verified.text()).toBe(true);
    return (await verified.json()).order as { id: string; tokenNo: number };
  }
  return order as { id: string; tokenNo: number };
}

async function openBoard(page: Page) {
  // Count the tones played, to check the chime without speakers.
  await page.addInitScript((id) => {
    localStorage.setItem('mom.vendor.stall', id);
    const w = window as unknown as { __tones: number };
    w.__tones = 0;
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      w.__tones++;
      return original.call(this);
    };
  }, stallId);
  const connected = page.waitForResponse(
    (r) => r.url().includes(`/v1/vendor/stalls/${stallId}/orders/events`) && r.status() === 200,
  );
  await page.goto('/vendor');
  await expect(page.getByRole('heading', { name: "Today's orders" })).toBeVisible();
  await connected;
}

const tones = (page: Page) => page.evaluate(() => (window as unknown as { __tones: number }).__tones);

test('a new order appears within 2 s with a chime; accept and mark ready reach the student', async ({
  page,
  isMobile,
}) => {
  await openBoard(page);
  await page.getByRole('button', { name: 'Turn on order sound' }).click();
  await expect(page.getByRole('button', { name: 'Sound on' })).toBeVisible();
  const before = await tones(page);

  const order = await studentOrders('cash', 'less oil please');
  const card = page.getByRole('article', { name: `Token ${order.tokenNo}` }).last();
  await expect(card).toBeVisible({ timeout: 2000 });
  await expect(card).toContainText('2 × Masala Dosa');
  await expect(card).toContainText('less oil please');
  await expect(card).toContainText('Cash due ₹127.20');
  await expect.poll(() => tones(page)).toBeGreaterThan(before);
  await expect(page).toHaveTitle(/^\(1\) /);

  await card.getByRole('button', { name: 'Accept' }).click();
  if (isMobile) await page.getByRole('tab', { name: /^Preparing/ }).click();
  const preparing = page.getByRole('article', { name: `Token ${order.tokenNo}` }).last();
  await preparing.getByRole('button', { name: 'Mark ready' }).click();
  if (isMobile) await page.getByRole('tab', { name: /^Ready/ }).click();
  await expect(page.getByRole('article', { name: `Token ${order.tokenNo}` }).last()).toContainText(
    'Waiting for the student',
  );
  await expect(page).not.toHaveTitle(/^\(\d+\) /);

  const seen = await (await student.get(`${API_URL}/v1/orders/${order.id}`)).json();
  expect(seen.order.status).toBe('ready');
});

test('rejecting a paid UPI order asks why and refunds it', async ({ page, isMobile }) => {
  await openBoard(page);
  const order = await studentOrders('upi');
  if (isMobile) await page.getByRole('tab', { name: /^New/ }).click();
  const card = page.getByRole('article', { name: `Token ${order.tokenNo}` }).last();
  await expect(card).toContainText('UPI paid', { timeout: 2000 });
  await card.getByRole('button', { name: 'Reject' }).click();

  const sheet = page.getByRole('dialog', { name: `Reject token #${order.tokenNo}?` });
  await expect(sheet).toContainText('refunded automatically');
  await sheet.getByLabel('Other').check();
  await expect(sheet.getByRole('button', { name: 'Reject order' })).toBeDisabled(); // no reason yet
  await sheet.getByLabel('Reason').fill('Gas cylinder ran out');
  await sheet.getByRole('button', { name: 'Reject order' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'rejected. Refund started.' })).toBeVisible();
  await page.getByText(/^Finished today/).click();
  await expect(page.getByText('“Gas cylinder ran out”')).toBeVisible();

  const seen = await (await student.get(`${API_URL}/v1/orders/${order.id}`)).json();
  expect(seen.order).toMatchObject({
    status: 'rejected',
    paymentStatus: 'refunded',
    rejectReason: 'Gas cylinder ran out',
  });
});
