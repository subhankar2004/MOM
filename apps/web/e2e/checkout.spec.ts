import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { addMenu, createTestStall, updateDish } from './support/db';
import { PHONES } from './support/env';
import { stubRazorpay } from './support/razorpay-stub';
import { signIn } from './support/session';

const unique = (base: string) => `${base}-${test.info().project.name.replace(/[^a-z0-9]/g, '')}`;
const studentPhone = () =>
  test.info().project.name === 'desktop' ? PHONES.orderDesktop : PHONES.orderPhone360;

/** An open test stall (UPI + cash) with Samosa ₹20 and Lassi ₹40; puts both in the cart. */
async function cartAtTestStall(page: Page, base: string) {
  const slug = `e2e-${unique(base)}`;
  const stallId = await createTestStall(slug, { open: true, upi: true });
  await addMenu(stallId, [
    [
      'Snacks',
      [
        ['Samosa', 20],
        ['Lassi', 40],
      ],
    ],
  ]);
  await page.goto(`/stalls/${slug}`);
  await page.getByRole('button', { name: 'Add Samosa' }).click();
  await page.getByRole('button', { name: 'Add Lassi' }).click();
  return { stallId, slug };
}

test.describe('signed in', () => {
  test.describe.configure({ mode: 'serial' }); // same student: one order at a time
  // Sign this project's student in once (OTPs have a 30 s resend cooldown) and reuse the session.
  const stateFile = () => `e2e/.auth/order-${test.info().project.name}.json`;
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    await signIn(context, studentPhone());
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

  test('cash order: cart → checkout → token at once (acceptance)', async ({ page }) => {
    await cartAtTestStall(page, 'checkout-cash');
    await page.getByRole('link', { name: /View cart/ }).click();
    await page.getByRole('link', { name: 'Continue to payment' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Checkout' })).toBeVisible();

    // Both methods offered; UPI is picked by default, the student switches to cash.
    await expect(page.getByRole('radio', { name: /Pay now by UPI/ })).toBeChecked();
    const cash = page.getByRole('radio', { name: /Pay cash at the counter/ });
    await cash.check();
    await expect(cash).toBeChecked();
    // ₹60 + 1% (₹0.60) + 5% (₹3.00) = ₹63.60
    await expect(page.getByText('Cash handling fee (5%)')).toBeVisible();
    await page.getByRole('button', { name: 'Place order · ₹63.60' }).click();

    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    const ticket = page.getByRole('img', { name: /^Token 1 at Test checkout-cash/ });
    await expect(ticket).toBeVisible();
    await expect(ticket).toHaveAttribute('aria-label', /pickup code \d{4}$/);
    await expect(page.getByText('Pay ₹63.60 in cash when you collect.')).toBeVisible();
    await expect(page.getByRole('link', { name: /View cart/ })).toHaveCount(0); // cart emptied

    // The order page survives a reload (it's loaded from the server)
    await page.reload();
    await expect(page.getByRole('img', { name: /^Token 1 at/ })).toBeVisible();
  });

  test('if a price changes during checkout, the order is refused and the new total shown', async ({
    page,
  }) => {
    const { stallId } = await cartAtTestStall(page, 'checkout-price');
    await page.goto('/checkout');
    await page.getByRole('radio', { name: /Pay cash at the counter/ }).check();
    await expect(page.getByRole('button', { name: 'Place order · ₹63.60' })).toBeEnabled();
    await updateDish(stallId, 'Lassi', { rupees: 50 }); // stall raises the price meanwhile

    await page.getByRole('button', { name: 'Place order · ₹63.60' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Prices changed' })).toContainText(
      'Prices changed since you opened checkout',
    );
    // The bill refreshed: ₹70 + ₹0.70 + ₹3.50
    await expect(page.getByRole('button', { name: 'Place order · ₹74.20' })).toBeVisible();
    await expect(page).toHaveURL(/\/checkout$/); // no order was placed
  });
});

test.describe('paying by UPI', () => {
  test.describe.configure({ mode: 'serial' });
  const stateFile = () => `e2e/.auth/upi-${test.info().project.name}.json`;
  const upiPhone = () => (test.info().project.name === 'desktop' ? PHONES.upiDesktop : PHONES.upiPhone360);
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    await signIn(context, upiPhone());
    await context.storageState({ path: stateFile() });
    await context.close();
  });
  test.beforeEach(async ({ context, page }) => {
    const state = JSON.parse(readFileSync(stateFile(), 'utf8')) as {
      cookies: Parameters<typeof context.addCookies>[0];
    };
    await context.addCookies(state.cookies);
    await context.addInitScript(() => localStorage.setItem('mom.session', '1'));
    await stubRazorpay(page);
  });

  test('UPI order: pay in the Razorpay window → token appears (server-verified signature)', async ({
    page,
  }) => {
    await cartAtTestStall(page, 'checkout-upi');
    await page.goto('/checkout');
    await expect(page.getByRole('radio', { name: /Pay now by UPI/ })).toBeChecked();
    // ₹60 + 1% = ₹60.60 (no cash fee)
    await page.getByRole('button', { name: 'Place order · ₹60.60' }).click();

    // The payment window opens by itself and "pays"; the server verifies and issues the token.
    await expect(page.getByRole('img', { name: /^Token 1 at Test checkout-upi/ })).toBeVisible();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    const opts = await page.evaluate(
      () => (window as unknown as { __rzpLastOptions: { amount: number; key: string } }).__rzpLastOptions,
    );
    expect(opts).toMatchObject({ amount: 6060, key: 'rzp_test_e2efake' });
    await page.reload();
    await expect(page.getByRole('img', { name: /^Token 1 at/ })).toBeVisible(); // stored on the server
  });

  test('closing the payment window shows a retry; paying then works', async ({ page }) => {
    await cartAtTestStall(page, 'checkout-upi-retry');
    await page.addInitScript(() => ((window as unknown as { __rzpMode: string }).__rzpMode = 'dismiss'));
    await page.goto('/checkout');
    await page.getByRole('button', { name: 'Place order · ₹60.60' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Payment was not completed' })).toBeVisible();
    await expect(page.getByText(/Pay within \d+:\d{2}/)).toBeVisible(); // countdown to the deadline
    await page.getByRole('button', { name: 'Try again ₹60.60 by UPI' }).click();
    await expect(page.getByRole('img', { name: /^Token 1 at Test checkout-upi-retry/ })).toBeVisible();
  });
});

test('checkout needs sign-in', async ({ page }) => {
  await cartAtTestStall(page, 'checkout-anon');
  await page.goto('/checkout');
  await expect(page).toHaveURL(/\/login\?next=%2Fcheckout$/);
});
