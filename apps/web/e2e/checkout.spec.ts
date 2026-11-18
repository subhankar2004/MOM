import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { addMenu, createTestStall, updateDish } from './support/db';
import { PHONES } from './support/env';
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

    // UPI is shown but not available yet (#15); cash is selected.
    await expect(page.getByRole('radio', { name: /Pay now by UPI/ })).toBeDisabled();
    await expect(page.getByText('UPI payments are being set up')).toBeVisible();
    const cash = page.getByRole('radio', { name: /Pay cash at the counter/ });
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

test('checkout needs sign-in', async ({ page }) => {
  await cartAtTestStall(page, 'checkout-anon');
  await page.goto('/checkout');
  await expect(page).toHaveURL(/\/login\?next=%2Fcheckout$/);
});
