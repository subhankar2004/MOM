import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { addMenu, addStallMember, createTestStall, createUser, withDb } from './support/db';
import { API_URL, E2E_RAZORPAY_SECRET, PHONES, STORAGE, WEB_URL } from './support/env';
import { signIn } from './support/session';

/**
 * Settlements: a stall's cash fees are settled to ₹0.00 through the admin console, and a UPI
 * order handed over releases its Razorpay transfer (test-mode gateway).
 */
test.describe.configure({ mode: 'serial' });
test.use({ storageState: STORAGE.admin });
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('mom.session', '1'));
});

const project = () => test.info().project.name.replace(/[^a-z0-9]/g, '');
const headers = { origin: WEB_URL };
const stallName = () => `Test settle-${project()}`;
let stallId: string;
let owner: APIRequestContext;
let student: APIRequestContext;
let dosaId: string;

test.beforeAll(async ({ browser }) => {
  const desktop = project() === 'desktop';
  stallId = await createTestStall(`e2e-settle-${project()}`, { open: true, upi: true });
  await addMenu(stallId, [['Tiffin', [['Masala Dosa', 60]]]]);
  // A Razorpay linked account, so UPI orders pay the stall through Route.
  await withDb((db) =>
    db.query(`update stalls set razorpay_account_id = $2 where id = $1`, [stallId, `acc_e2e${project()}`]),
  );
  const ownerPhone = desktop ? PHONES.settleVendorDesktop : PHONES.settleVendor360;
  await createUser(ownerPhone, 'Settle Owner', 'vendor_owner');
  await addStallMember(stallId, ownerPhone);
  const ownerCtx = await browser.newContext();
  await signIn(ownerCtx, ownerPhone, 'Settle Owner');
  owner = ownerCtx.request;
  const studentCtx = await browser.newContext();
  await signIn(studentCtx, desktop ? PHONES.settleStudentDesktop : PHONES.settleStudent360, 'Settle Student');
  student = studentCtx.request;
  const menu = await (await student.get(`${API_URL}/v1/stalls/e2e-settle-${project()}/menu`)).json();
  dosaId = menu.categories[0].items[0].id;
});

async function order(method: 'cash' | 'upi') {
  const res = await student.post(`${API_URL}/v1/orders`, {
    headers: { ...headers, 'idempotency-key': `settle-${project()}-${method}-${Date.now()}` },
    data: {
      stallId,
      items: [{ itemId: dosaId, quantity: 2 }],
      paymentMethod: method,
      expectedTotalPaise: method === 'cash' ? 12720 : 12120,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { order: o } = await res.json();
  if (method === 'upi') {
    const start = await (
      await student.post(`${API_URL}/v1/payments/razorpay/order`, { data: { orderId: o.id }, headers })
    ).json();
    const paymentId = `pay_settle_${project()}_${Date.now()}`;
    const verified = await student.post(`${API_URL}/v1/payments/razorpay/verify`, {
      headers,
      data: {
        orderId: o.id,
        razorpayOrderId: start.razorpayOrderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: createHmac('sha256', E2E_RAZORPAY_SECRET)
          .update(`${start.razorpayOrderId}|${paymentId}`)
          .digest('hex'),
      },
    });
    expect(verified.ok(), await verified.text()).toBe(true);
  }
  const handed = await owner.post(`${API_URL}/v1/vendor/stalls/${stallId}/orders/${o.id}/handover`, {
    headers,
    data: { cashReceived: method === 'cash' },
  });
  expect(handed.ok(), await handed.text()).toBe(true);
  return o.id as string;
}

test('a UPI order handed over releases its transfer to the stall', async ({ page }) => {
  const id = await order('upi');
  await page.goto(`/admin/orders/${id}`);
  await expect(page.getByText(/₹120\.00 · Paid out to the stall · trf_/)).toBeVisible();
});

test("a stall's cash fees are settled and its statement closes at ₹0.00", async ({ page }) => {
  await order('cash'); // MOM fees ₹1.20 + ₹6.00 = ₹7.20 owed

  await page.goto('/admin/settlements');
  const row = page.getByRole('row', { name: new RegExp(`^${stallName()} `) });
  await expect(row).toContainText('₹7.20');
  await row.getByRole('link', { name: stallName() }).click();

  await expect(page.getByRole('heading', { level: 1, name: stallName() })).toBeVisible();
  await page.getByRole('tab', { name: 'This week' }).click();
  await expect(page.getByRole('row', { name: /Closing balance/ })).toContainText('₹7.20');
  await expect(page.getByRole('link', { name: /MOM fees on cash token #\d+/ })).toBeVisible();

  await page.getByRole('button', { name: 'Record cash received' }).click();
  const sheet = page.getByRole('dialog', { name: 'Record cash received' });
  await expect(sheet.getByLabel('Amount received')).toHaveValue('7.20');
  await sheet.getByLabel('Note (optional)').fill('Collected at the stall');
  await sheet.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('₹7.20 recorded. Still owed: ₹0.00')).toBeVisible();
  await expect(page.getByRole('row', { name: /Closing balance/ })).toContainText('₹0.00');
  await expect(page.getByRole('row', { name: /Cash paid to MOM/ })).toContainText('-₹7.20');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV' }).click(),
  ]);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv).toMatch(/Closing balance,,0\.00\r\n$/);

  await page.getByRole('link', { name: 'All stalls' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`^${stallName()} `) })).toContainText('₹0.00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
});
