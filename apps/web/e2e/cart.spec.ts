import { expect, test, type Page } from '@playwright/test';
import { addMenu, createTestStall, setStallOpen, updateDish } from './support/db';

const unique = (base: string) => `${base}-${test.info().project.name.replace(/[^a-z0-9]/g, '')}`;
const line = (page: Page, name: string) =>
  page
    .getByRole('list', { name: /^Dishes from / })
    .getByRole('listitem')
    .filter({ hasText: name });

/** An open test stall with Lassi ₹40, Samosa ₹20 and Veg Thali ₹90; opens its menu. */
async function stallWithMenu(page: Page, base: string) {
  const slug = `e2e-${unique(base)}`;
  const id = await createTestStall(slug, { open: true, upi: true });
  await addMenu(id, [
    [
      'Snacks',
      [
        ['Samosa', 20],
        ['Lassi', 40],
      ],
    ],
    ['Meals', [['Veg Thali', 90]]],
  ]);
  await page.goto(`/stalls/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return id;
}

test('the cart bar shows the total, and the cart survives a reload', async ({ page }) => {
  await stallWithMenu(page, 'cart-persist');
  await page.getByRole('button', { name: 'Add Lassi' }).click();
  await page.getByRole('button', { name: 'Add Samosa' }).click();
  await page
    .getByRole('group', { name: 'Quantity of Samosa' })
    .getByRole('button', { name: 'Add one more Samosa' })
    .click();

  const bar = page.getByRole('link', { name: /View cart/ });
  await expect(bar).toContainText('3 items · ₹80');

  await page.reload(); // acceptance: survives a reload
  await expect(page.getByRole('link', { name: /View cart/ })).toContainText('3 items · ₹80');
  await expect(page.getByRole('group', { name: 'Quantity of Samosa' })).toContainText('2');

  await page.getByRole('link', { name: /View cart/ }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Your cart' })).toBeVisible();
  await expect(line(page, 'Lassi')).toContainText('₹40');
  await expect(line(page, 'Samosa')).toContainText('₹40'); // 2 × ₹20
});

test('the bill shows UPI and cash totals from the server, and updates with quantities', async ({ page }) => {
  await stallWithMenu(page, 'cart-bill');
  await page.getByRole('button', { name: 'Add Veg Thali' }).click(); // ₹90
  await page.getByRole('button', { name: 'Add Lassi' }).click(); // ₹40 → ₹130
  await page.goto('/cart');
  const upi = page.getByRole('region', { name: 'Pay by UPI' });
  const cash = page.getByRole('region', { name: 'Pay in cash at the counter' });
  await expect(upi).toContainText('₹131.30');
  await expect(cash).toContainText('₹137.80');

  await line(page, 'Lassi').getByRole('button', { name: 'Add one more Lassi' }).click(); // ₹170
  await expect(upi).toContainText('₹171.70');
  await expect(cash).toContainText('₹180.20');
});

test('a price the stall changed is shown before payment (acceptance)', async ({ page }) => {
  const stallId = await stallWithMenu(page, 'cart-price');
  await page.getByRole('button', { name: 'Add Lassi' }).click();
  await updateDish(stallId, 'Lassi', { rupees: 45 }); // the vendor raises the price

  await page.goto('/cart');
  await expect(page.getByRole('status').filter({ hasText: 'A price has changed' })).toBeVisible();
  await expect(line(page, 'Lassi')).toContainText('Price changed from ₹40 to ₹45');
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeDisabled();

  await page.getByRole('button', { name: 'Accept new prices' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'A price has changed' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Continue to payment' })).toBeVisible();
  await expect(page.getByRole('link', { name: /View cart/ })).toHaveCount(0); // no bar on the cart page
});

test('a dish that sold out after adding must be removed before paying', async ({ page }) => {
  const stallId = await stallWithMenu(page, 'cart-soldout');
  await page.getByRole('button', { name: 'Add Samosa' }).click();
  await page.getByRole('button', { name: 'Add Lassi' }).click();
  await updateDish(stallId, 'Samosa', { available: false });

  await page.goto('/cart');
  await expect(line(page, 'Samosa')).toContainText('Sold out now');
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
  await line(page, 'Samosa').getByRole('button', { name: 'Remove' }).click();
  await expect(line(page, 'Samosa')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Continue to payment' })).toBeVisible();
});

test('a stall that closed meanwhile blocks payment with an explanation', async ({ page }) => {
  const stallId = await stallWithMenu(page, 'cart-closed');
  await page.getByRole('button', { name: 'Add Lassi' }).click();
  await setStallOpen(stallId, false);
  await page.goto('/cart');
  await expect(page.getByRole('status').filter({ hasText: 'closed right now' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
});

test('the note is kept, and emptying the cart shows the empty state', async ({ page }) => {
  await stallWithMenu(page, 'cart-note');
  await page.getByRole('button', { name: 'Add Lassi' }).click();
  await page.goto('/cart');
  await page.getByRole('textbox', { name: /Note for the stall/ }).fill('Less sugar please');
  await page.reload();
  await expect(page.getByRole('textbox', { name: /Note for the stall/ })).toHaveValue('Less sugar please');

  await page.getByRole('button', { name: 'Empty cart' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your cart is empty' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Your cart is empty' })).toBeVisible();
});
