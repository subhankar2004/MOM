import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { addMenu, createTestStall, setOrderStatus } from './support/db';
import { PHONES } from './support/env';
import { signIn } from './support/session';

const unique = (base: string) => `${base}-${test.info().project.name.replace(/[^a-z0-9]/g, '')}`;

test.describe.configure({ mode: 'serial' });
const stateFile = () => `e2e/.auth/live-${test.info().project.name}.json`;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context, test.info().project.name === 'desktop' ? PHONES.liveDesktop : PHONES.livePhone360);
  await context.storageState({ path: stateFile() });
  await context.close();
});
test.beforeEach(async ({ context }) => {
  const state = JSON.parse(readFileSync(stateFile(), 'utf8')) as {
    cookies: Parameters<typeof context.addCookies>[0];
  };
  await context.addCookies(state.cookies);
  await context.addInitScript(() => localStorage.setItem('mom.session', '1'));
});

/** Places a cash order through the UI and returns its id (the page is left on the token screen). */
async function placeOrder(page: Page, name: string): Promise<string> {
  const slug = `e2e-${unique(name)}`;
  const stallId = await createTestStall(slug, { open: true });
  await addMenu(stallId, [
    [
      'Snacks',
      [
        ['Samosa', 20],
        ['Vada Pav', 30],
      ],
    ],
  ]);
  await page.goto(`/stalls/${slug}`);
  await page.getByRole('button', { name: 'Add Samosa' }).click();
  await page.goto('/checkout');
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('img', { name: /^Token 1 at/ })).toBeVisible();
  return page.url().split('/').pop()!;
}

/** Waits until the page's live connection to the API is open. */
async function liveConnected(page: Page) {
  await page.waitForResponse((r) => r.url().includes('/v1/orders/events') && r.status() === 200);
}

test('the stall marks the order ready → the token screen turns green within 2 s', async ({ page }) => {
  const connected = liveConnected(page);
  const orderId = await placeOrder(page, 'live-ready');
  await connected;

  await setOrderStatus(orderId, 'preparing');
  const steps = page.getByRole('list', { name: 'Order progress' });
  await expect(steps.locator('[aria-current="step"]')).toContainText('Preparing', { timeout: 2000 });

  await setOrderStatus(orderId, 'ready');
  await expect(page.getByRole('heading', { name: 'Ready to collect' })).toBeVisible({ timeout: 2000 });
  await expect(page.getByText('Show token #1 at')).toBeVisible();
  await setOrderStatus(orderId, 'collected');
});

test('after the network drops, the page catches up when it comes back', async ({ page, context }) => {
  const connected = liveConnected(page);
  const orderId = await placeOrder(page, 'live-offline');
  await connected;

  await context.setOffline(true);
  await setOrderStatus(orderId, 'ready'); // happens while the phone has no signal
  await page.waitForTimeout(1000);
  await context.setOffline(false);
  await expect(page.getByRole('heading', { name: 'Ready to collect' })).toBeVisible({ timeout: 10_000 });
  await setOrderStatus(orderId, 'collected');
});

test('my orders: live active list, ready notice anywhere in the app, then history and order again', async ({
  page,
}) => {
  const orderId = await placeOrder(page, 'live-list');
  const connected = liveConnected(page);
  await page.goto('/orders');
  await connected;
  await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
  const row = page.getByRole('link', { name: /Samosa/ });
  await expect(row).toContainText('#1');
  await expect(row).toContainText('Placed');

  // Ready while the student is on another page: a notice pops up and the row turns ready.
  await setOrderStatus(orderId, 'ready');
  await expect(page.getByRole('status').filter({ hasText: 'Token #1 is ready' })).toBeVisible({
    timeout: 2000,
  });
  await expect(row).toContainText('Ready to collect');

  // Collected → moves to Past; "Order again" refills the cart.
  await setOrderStatus(orderId, 'collected');
  await expect(page.getByText('Nothing cooking right now')).toBeVisible({ timeout: 2000 });
  await page.getByRole('tab', { name: 'Past' }).click();
  await expect(page.getByText('1 × Samosa').first()).toBeVisible();
  await page
    .getByRole('button', { name: /^Order again from .*live-list/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByText('Samosa').first()).toBeVisible();
});

test('a placed order can be cancelled, with a second tap to confirm', async ({ page }) => {
  await placeOrder(page, 'live-cancel');
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.getByRole('button', { name: 'Yes, cancel' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Order cancelled.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: /^Token 1 at/ })).toContainText('Cancelled');
});
