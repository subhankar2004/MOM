import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { addMenu, addStallMember, createTestStall, createUser } from './support/db';
import { API_URL, PHONES, STORAGE, WEB_URL } from './support/env';
import { signIn } from './support/session';

/**
 * Overview, revenue and the money check in the admin console. Other tests share this database,
 * so this checks behaviour and structure; the exact numbers are proven by the API tests
 * against a hand-computed day.
 */
test.describe.configure({ mode: 'serial' });
test.use({ storageState: STORAGE.admin });
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('mom.session', '1'));
});

const project = () => test.info().project.name.replace(/[^a-z0-9]/g, '');
const stallName = () => `Test fin-${project()}`;

/** One cash order of 2 × ₹60, handed over with the cash: MOM earns ₹1.20 + ₹6.00 = ₹7.20. */
test.beforeAll(async ({ browser }) => {
  const desktop = project() === 'desktop';
  const stallId = await createTestStall(`e2e-fin-${project()}`, { open: true });
  await addMenu(stallId, [['Tiffin', [['Masala Dosa', 60]]]]);
  const ownerPhone = desktop ? PHONES.financeVendorDesktop : PHONES.financeVendor360;
  await createUser(ownerPhone, 'Finance Owner', 'vendor_owner');
  await addStallMember(stallId, ownerPhone);
  const owner = await browser.newContext();
  await signIn(owner, ownerPhone, 'Finance Owner');
  const student = await browser.newContext();
  await signIn(student, desktop ? PHONES.financeStudentDesktop : PHONES.financeStudent360, 'Finance Student');
  const menu = await (await student.request.get(`${API_URL}/v1/stalls/e2e-fin-${project()}/menu`)).json();
  const placed = await student.request.post(`${API_URL}/v1/orders`, {
    headers: { origin: WEB_URL, 'idempotency-key': `fin-${project()}-${Date.now()}` },
    data: {
      stallId,
      items: [{ itemId: menu.categories[0].items[0].id, quantity: 2 }],
      paymentMethod: 'cash',
      expectedTotalPaise: 12720,
    },
  });
  expect(placed.status(), await placed.text()).toBe(201);
  const { order } = await placed.json();
  const handed = await owner.request.post(
    `${API_URL}/v1/vendor/stalls/${stallId}/orders/${order.id}/handover`,
    {
      headers: { origin: WEB_URL },
      data: { cashReceived: true },
    },
  );
  expect(handed.ok(), await handed.text()).toBe(true);
  await owner.close();
  await student.close();
});

test('overview shows today and runs the money check on demand', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByText(/^Today, /)).toBeVisible();
  for (const label of ['Orders', 'Order value', 'MOM revenue', 'Failed payments']) {
    await expect(page.getByRole('main').getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Live orders' })).toBeVisible();

  await page.getByRole('button', { name: 'Run now' }).click();
  // Whatever other tests left behind, a run is stored and reported.
  await expect(page.getByText(/(Everything matches|Mismatches found) · \d+ orders? checked/)).toBeVisible();
  await expect(page.getByText(/Money check (OK|found)/)).toBeVisible();
  await page.screenshot({ path: `test-results/overview-${project()}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
});

test('revenue: periods, chart, per-stall table and CSVs', async ({ page }) => {
  await page.goto('/admin/revenue');
  await expect(page.getByRole('heading', { level: 1, name: 'Revenue' })).toBeVisible();
  const bars = page.getByRole('list', { name: 'MOM fees per period' }).getByRole('listitem');
  await expect(bars).toHaveCount(30);

  await page.getByRole('tab', { name: 'Last 12 weeks' }).click();
  // 84 days touch 12 Monday-started weeks when they start on a Monday, otherwise 13.
  await expect.poll(async () => [12, 13].includes(await bars.count())).toBe(true);
  await page.getByRole('tab', { name: 'Last 12 months' }).click();
  await expect(bars).toHaveCount(12);
  // This test's stall earned MOM ₹7.20 (₹1.20 platform + ₹6.00 cash fee) today.
  const row = page.getByRole('row', { name: new RegExp(`^${stallName()} `) });
  await expect(row).toContainText('₹1.20');
  await expect(row).toContainText('₹6.00');
  await expect(row).toContainText('₹7.20');
  await page.screenshot({ path: `test-results/revenue-${project()}.png`, fullPage: true });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .getByRole('region', { name: 'Commission per stall' })
      .getByRole('button', { name: 'Download CSV' })
      .click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^mom-revenue-by-stall-.*\.csv$/);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv).toContain(
    'Stall,Orders,Order value (₹),Platform fees (₹),Cash fees (₹),Refunded (₹),MOM revenue (₹)',
  );
  expect(csv).toMatch(/\r\nTotal,\d+,/);
  expect(csv).toContain(`${stallName()},1,127.20,1.20,6.00,0.00,7.20`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
});
