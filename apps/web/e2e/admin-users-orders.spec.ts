import { readFileSync } from 'node:fs';
import { expect, test, type Browser } from '@playwright/test';
import { addMenu, createTestStall } from './support/db';
import { API_URL, PHONES, STORAGE, WEB_URL } from './support/env';
import { signIn } from './support/session';

/**
 * Users & orders in the admin console: find a student, suspend and reactivate them; find
 * their order, cancel it with a reason, and the student sees why.
 */
test.describe.configure({ mode: 'serial' });

const project = () => test.info().project.name.replace(/[^a-z0-9]/g, '');
const studentPhone = () => (project() === 'desktop' ? PHONES.adminTargetDesktop : PHONES.adminTarget360);
const studentFile = () => `e2e/.auth/admin-target-${test.info().project.name}.json`;
const studentName = () => (project() === 'desktop' ? 'Target Desktop' : 'Target Phone');
let slug: string;

test.beforeAll(async ({ browser }) => {
  slug = `e2e-admin-orders-${project()}`;
  const stallId = await createTestStall(slug, { open: true });
  await addMenu(stallId, [['Tiffin', [['Masala Dosa', 60]]]]);
  const ctx = await browser.newContext();
  await signIn(ctx, studentPhone(), studentName());
  await ctx.storageState({ path: studentFile() });
  await ctx.close();
});

async function adminPage(browser: Browser) {
  const ctx = await browser.newContext({ storageState: STORAGE.admin });
  await ctx.addInitScript(() => localStorage.setItem('mom.session', '1'));
  return ctx.newPage();
}

test("admin cancels a student's order with a reason, and the student sees it", async ({ browser }) => {
  // (Runs before the suspension test, which ends this student's sessions.)
  const studentCtx = await browser.newContext({ storageState: studentFile() });
  await studentCtx.addInitScript(() => localStorage.setItem('mom.session', '1'));
  const menu = await (await studentCtx.request.get(`${API_URL}/v1/stalls/${slug}/menu`)).json();
  const stallId = menu.stall.id as string;
  const placed = await studentCtx.request.post(`${API_URL}/v1/orders`, {
    headers: { origin: WEB_URL, 'idempotency-key': `admin-orders-${project()}-${Date.now()}` },
    data: {
      stallId,
      items: [{ itemId: menu.categories[0].items[0].id, quantity: 1 }],
      paymentMethod: 'cash',
      expectedTotalPaise: 6360,
    },
  });
  expect(placed.status(), await placed.text()).toBe(201);
  const { order } = await placed.json();

  const page = await adminPage(browser);
  await page.goto('/admin/orders');
  await page.getByLabel('Stall', { exact: true }).selectOption(stallId);
  await page.getByLabel('Search').fill(`#${order.tokenNo}`);
  // Stall + token pick out exactly this order (the student column may be scrolled off on phones).
  const table = page.getByRole('region', { name: 'Orders' });
  await expect(table.getByRole('row')).toHaveCount(2); // header + this order
  await expect(table).toContainText(studentPhone());
  await table.getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: new RegExp(`Token #${order.tokenNo}`) })).toBeVisible();
  await expect(page.getByText('1 × Masala Dosa')).toBeVisible();

  await page.getByRole('button', { name: 'Cancel order…' }).click();
  const sheet = page.getByRole('dialog', { name: 'Cancel this order?' });
  await sheet.getByLabel(/Reason/).fill('Stall closed early today');
  await sheet.getByRole('button', { name: 'Cancel order' }).click();
  await expect(page.getByText('Order cancelled', { exact: true })).toBeVisible();
  await expect(page.getByText('Cancelled by MOM: “Stall closed early today”')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel order…' })).toBeHidden();
  await page.context().close();

  const student = await studentCtx.newPage();
  await student.goto(`/orders/${order.id}`);
  await expect(student.getByText('Cancelled by MOM: “Stall closed early today”')).toBeVisible();
  await studentCtx.close();
});

test('admin finds a student by phone, suspends and reactivates them', async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto('/admin/users');
  await page.getByLabel('Search').fill(studentPhone().slice(-5));
  await page.getByRole('link', { name: new RegExp(studentName()) }).click();
  await expect(page.getByRole('heading', { name: studentName(), level: 1 })).toBeVisible();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  // Suspending asks first.
  await page.getByRole('button', { name: 'Suspend…' }).click();
  await expect(page.getByText(/signed out on every device/)).toBeVisible();
  await page.getByRole('button', { name: 'Suspend account' }).click();
  await expect(page.getByText('Account suspended')).toBeVisible();
  await expect(page.getByText('Suspended', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out everywhere' })).toBeDisabled();

  // The student's session can't be renewed any more.
  const state = JSON.parse(readFileSync(studentFile(), 'utf8')) as {
    cookies: Array<{ name: string; value: string }>;
  };
  const refresh = state.cookies.find((c) => c.name === 'mom_rt')!.value;
  // (In its own browser: a refused refresh clears that browser's cookies.)
  const other = await browser.newContext();
  const renewed = await other.request.post(`${API_URL}/v1/auth/refresh`, {
    headers: { origin: WEB_URL, cookie: `mom_rt=${refresh}` },
  });
  expect(renewed.status()).toBe(401);
  await other.close();

  await page.getByRole('button', { name: 'Reactivate account' }).click();
  await expect(page.getByText('Account reactivated')).toBeVisible();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await page.context().close();
});
