import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { addMenu, addStallMember, createTestStall, createUser } from './support/db';
import { API_URL, E2E_RAZORPAY_SECRET, PHONES, WEB_URL } from './support/env';
import { signIn } from './support/session';

/**
 * The pickup counter, end to end: the student's real QR (rendered on their order page) is
 * shown to the vendor's camera — a fake camera that films it — decoded in the browser,
 * verified by the API, and handed over in one tap.
 */
test.describe.configure({ mode: 'serial' });

const project = () => test.info().project.name.replace(/[^a-z0-9]/g, '');
const desktop = () => project() === 'desktop';
const headers = { origin: WEB_URL };
const ownerFile = () => `e2e/.auth/scan-owner-${test.info().project.name}.json`;
const studentFile = () => `e2e/.auth/scan-student-${test.info().project.name}.json`;

let stallId: string;
let otherStallId: string;
const dishes: Record<string, string> = {};
let student: APIRequestContext;
let owner: APIRequestContext;

test.beforeAll(async ({ browser }) => {
  stallId = await createTestStall(`e2e-scan-${project()}`, { open: true, upi: true });
  otherStallId = await createTestStall(`e2e-scan-other-${project()}`, { open: true, upi: true });
  await addMenu(stallId, [['Tiffin', [['Masala Dosa', 60]]]]);
  await addMenu(otherStallId, [['Tiffin', [['Masala Dosa', 60]]]]);
  const ownerPhone = desktop() ? PHONES.scanVendorDesktop : PHONES.scanVendor360;
  await createUser(ownerPhone, 'Scan Owner', 'vendor_owner');
  await addStallMember(stallId, ownerPhone);

  for (const [phone, name, file] of [
    [ownerPhone, 'Scan Owner', ownerFile()],
    [desktop() ? PHONES.scanDesktop : PHONES.scanPhone360, 'Scan Student', studentFile()],
  ] as const) {
    const ctx = await browser.newContext();
    await signIn(ctx, phone, name);
    await ctx.storageState({ path: file });
    if (file === ownerFile()) owner = ctx.request;
    else student = ctx.request;
  }
  for (const id of [stallId, otherStallId]) {
    const slug = id === stallId ? `e2e-scan-${project()}` : `e2e-scan-other-${project()}`;
    const menu = await (await student.get(`${API_URL}/v1/stalls/${slug}/menu`)).json();
    dishes[id] = menu.categories[0].items[0].id;
  }
});

/** The student orders 2 × ₹60 over the API (UPI is paid with a signed test payment). */
async function studentOrders(method: 'cash' | 'upi', at = stallId) {
  const res = await student.post(`${API_URL}/v1/orders`, {
    headers: { ...headers, 'idempotency-key': `scan-${project()}-${Date.now()}-${Math.random()}` },
    data: {
      stallId: at,
      items: [{ itemId: dishes[at], quantity: 2 }],
      paymentMethod: method,
      // ₹120 + 1% platform fee (+ 5% cash fee)
      expectedTotalPaise: method === 'cash' ? 12720 : 12120,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const order = (await res.json()).order as { id: string; tokenNo: number | null; pickupCode: string };
  if (method === 'upi') {
    const start = await (
      await student.post(`${API_URL}/v1/payments/razorpay/order`, { data: { orderId: order.id }, headers })
    ).json();
    const paymentId = `pay_scan_${project()}_${Date.now()}`;
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
    return (await verified.json()).order as { id: string; tokenNo: number; pickupCode: string };
  }
  return order as { id: string; tokenNo: number; pickupCode: string };
}

async function pageFor(browser: Browser, file: string): Promise<Page> {
  const state = JSON.parse(readFileSync(file, 'utf8'));
  const ctx = await browser.newContext();
  await ctx.addCookies(state.cookies);
  await ctx.addInitScript(() => localStorage.setItem('mom.session', '1'));
  return ctx.newPage();
}

/** The student's QR exactly as their phone shows it (SVG markup). */
async function studentQr(browser: Browser, orderId: string): Promise<string> {
  const page = await pageFor(browser, studentFile());
  await page.goto(`/orders/${orderId}`);
  // Serialised with its namespace, so it can be loaded as a standalone image.
  const svg = await page.getByTestId('pickup-qr').evaluate((el) => new XMLSerializer().serializeToString(el));
  await page.context().close();
  return svg;
}

/**
 * Opens the scanner with a fake camera: a canvas that "films" whatever QR SVG the test puts in
 * window.__qr. The browser's own QR reader is hidden, so the JavaScript decoder (used on
 * iPhones) is what reads it.
 */
async function openScanner(browser: Browser): Promise<Page> {
  const page = await pageFor(browser, ownerFile());
  await page.addInitScript((id) => {
    localStorage.setItem('mom.vendor.stall', id);
    const w = window as unknown as { __qr: string | null; BarcodeDetector?: unknown };
    delete w.BarcodeDetector;
    w.__qr = null;
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    let shown: string | null = null;
    setInterval(() => {
      if (w.__qr !== shown) {
        shown = w.__qr;
        if (shown) img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shown)}`;
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 640, 480);
      if (shown && img.complete) ctx.drawImage(img, 170, 90, 300, 300);
    }, 50);
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(15);
  }, stallId);
  await page.goto('/vendor/scan');
  await expect(page.getByRole('heading', { name: 'Scan' })).toBeVisible();
  // No sideways scrolling on a phone (the token boxes once stretched the page to 680 px).
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  return page;
}

const show = (page: Page, svg: string | null) =>
  page.evaluate((s) => ((window as unknown as { __qr: string | null }).__qr = s), svg);

test('scanning a ready QR hands it over in one tap; scanning again says already collected', async ({
  browser,
}) => {
  const order = await studentOrders('upi');
  const ready = await owner.post(`${API_URL}/v1/vendor/stalls/${stallId}/orders/${order.id}/ready`, {
    headers,
  });
  expect(ready.ok()).toBe(true);
  const qr = await studentQr(browser, order.id);

  const page = await openScanner(browser);
  await show(page, qr);
  const card = page.getByRole('region', { name: 'Order verified' });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText(`#${order.tokenNo}`);
  await expect(card).toContainText('2 × Masala Dosa');
  await expect(card).toContainText('UPI paid');
  // The only tap needed:
  await card.getByRole('button', { name: 'Hand over' }).click();
  await expect(card.getByText(`Token #${order.tokenNo} handed over`)).toBeVisible();

  // The student's phone shows it collected.
  const mine = await (await student.get(`${API_URL}/v1/orders/${order.id}`)).json();
  expect(mine.order.status).toBe('collected');

  // Same QR again.
  await card.getByRole('button', { name: 'Scan next' }).click();
  const refused = page.getByRole('region', { name: 'Order not valid' });
  await expect(refused).toBeVisible({ timeout: 10_000 });
  await expect(refused).toContainText('Already collected');
  await page.context().close();
});

test("another stall's QR is rejected", async ({ browser }) => {
  const elsewhere = await studentOrders('cash', otherStallId);
  const qr = await studentQr(browser, elsewhere.id);
  const page = await openScanner(browser);
  await show(page, qr);
  const refused = page.getByRole('region', { name: 'Order not valid' });
  await expect(refused).toBeVisible({ timeout: 10_000 });
  await expect(refused).toContainText('This order is for another stall.');
  await expect(refused).not.toContainText('Masala Dosa');
  await page.context().close();
});

test('token + pickup code on the keypad; a cash order is paid and handed over together', async ({
  browser,
}) => {
  const order = await studentOrders('cash');
  const page = await openScanner(browser);
  const keypad = page.getByRole('group', { name: 'Keypad' });
  for (const d of String(order.tokenNo)) await keypad.getByRole('button', { name: d, exact: true }).click();
  await keypad.getByRole('button', { name: 'Next' }).click();
  // A wrong code first.
  const wrong = order.pickupCode === '0000' ? '1111' : '0000';
  for (const d of wrong) await keypad.getByRole('button', { name: d, exact: true }).click();
  await expect(page.getByRole('region', { name: 'Order not valid' })).toContainText('Not a valid order');
  await page.getByRole('button', { name: 'Scan next' }).click();

  await page.getByLabel('Token', { exact: true }).fill(String(order.tokenNo));
  await page.getByLabel('Pickup code', { exact: true }).fill(order.pickupCode);
  const card = page.getByRole('region', { name: 'Order verified' });
  await expect(card).toContainText('Not marked ready yet');
  await expect(card).toContainText('Cash due · ₹127.20');
  await card.getByRole('button', { name: 'Cash received ₹127.20 · Hand over' }).click();
  await expect(card.getByText(`Token #${order.tokenNo} handed over`)).toBeVisible();
  const mine = await (await student.get(`${API_URL}/v1/orders/${order.id}`)).json();
  expect(mine.order).toMatchObject({ status: 'collected', paymentStatus: 'paid_cash' });
  await page.context().close();
});
