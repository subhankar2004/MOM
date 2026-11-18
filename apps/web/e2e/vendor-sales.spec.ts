import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { addMenu, addStallMember, createTestStall, createUser } from './support/db';
import { API_URL, PHONES, WEB_URL } from './support/env';
import { signIn } from './support/session';

/** Sales & dues: two cash orders handed over today show up in the numbers, chart and CSV. */
test.describe.configure({ mode: 'serial' });

const project = () => test.info().project.name.replace(/[^a-z0-9]/g, '');
const desktop = () => project() === 'desktop';
const headers = { origin: WEB_URL };
const ownerFile = () => `e2e/.auth/sales-owner-${test.info().project.name}.json`;

test.beforeAll(async ({ browser }) => {
  const stallId = await createTestStall(`e2e-sales-${project()}`, { open: true });
  await addMenu(stallId, [['Tiffin', [['Masala Dosa', 60]]]]);
  const ownerPhone = desktop() ? PHONES.salesVendorDesktop : PHONES.salesVendor360;
  await createUser(ownerPhone, 'Sales Owner', 'vendor_owner');
  await addStallMember(stallId, ownerPhone);

  const ownerCtx = await browser.newContext();
  await signIn(ownerCtx, ownerPhone, 'Sales Owner');
  await ownerCtx.storageState({ path: ownerFile() });
  const studentCtx = await browser.newContext();
  await signIn(studentCtx, desktop() ? PHONES.salesDesktop : PHONES.salesPhone360, 'Sales Student');

  const owner: APIRequestContext = ownerCtx.request;
  const student: APIRequestContext = studentCtx.request;
  const menu = await (await student.get(`${API_URL}/v1/stalls/e2e-sales-${project()}/menu`)).json();
  const dosa = menu.categories[0].items[0].id;
  // Two cash orders of 2 × ₹60, handed over with the cash: ₹240 sales, fees 2 × (₹1.20 + ₹6).
  for (let i = 0; i < 2; i++) {
    const res = await student.post(`${API_URL}/v1/orders`, {
      headers: { ...headers, 'idempotency-key': `sales-${project()}-${i}-${Date.now()}` },
      data: {
        stallId,
        items: [{ itemId: dosa, quantity: 2 }],
        paymentMethod: 'cash',
        expectedTotalPaise: 12720,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const { order } = await res.json();
    const handed = await owner.post(`${API_URL}/v1/vendor/stalls/${stallId}/orders/${order.id}/handover`, {
      headers,
      data: { cashReceived: true },
    });
    expect(handed.ok(), await handed.text()).toBe(true);
  }
  await ownerCtx.close();
  await studentCtx.close();
});

test.beforeEach(async ({ context }) => {
  const state = JSON.parse(readFileSync(ownerFile(), 'utf8'));
  await context.addCookies(state.cookies);
  await context.addInitScript(() => localStorage.setItem('mom.session', '1'));
});

test("today's sales, cash fees owed, the week's chart and a CSV", async ({ page }) => {
  await page.goto('/vendor/sales');
  await expect(page.getByRole('heading', { name: 'Sales', level: 1 })).toBeVisible();
  await expect(page.getByText('2 orders handed over')).toBeVisible();
  await expect(page.getByText('₹240.00').first()).toBeVisible();
  // ₹254.40 taken in cash; MOM's fees ₹14.40 are owed back.
  await expect(page.getByText('₹254.40 taken incl. fees')).toBeVisible();
  const dues = page.getByRole('heading', { name: 'Cash fees owed to MOM' }).locator('..');
  await expect(dues).toContainText('₹14.40');

  await page.getByRole('tab', { name: 'Last 7 days' }).click();
  const chart = page.getByRole('list', { name: 'Sales per day' });
  await expect(chart.getByRole('listitem')).toHaveCount(7);
  const todayBar = chart.getByRole('listitem').last();
  await expect(todayBar).toHaveAttribute(
    'aria-label',
    /₹240\.00 from 2 orders \(UPI ₹0\.00, cash ₹240\.00\)/,
  );
  await todayBar.hover();
  await expect(page.getByRole('tooltip')).toContainText('₹240.00 · 2 orders');
  await page.screenshot({ path: `test-results/sales-${project()}.png`, fullPage: true });
  // No sideways scrolling on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^mom-sales-test-sales-.*\.csv$/);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv).toContain('Total,2,240.00,0.00,240.00,14.40');
});
