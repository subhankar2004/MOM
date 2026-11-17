import { expect, test } from '@playwright/test';
import { STORAGE } from './support/env';

test.describe('student shell', () => {
  test.use({ storageState: STORAGE.student });

  test('bottom tabs navigate and mark the current page', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'bottom tab bar is the phone navigation');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Stalls' })).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('link', { name: 'Orders' }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Your orders' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page');
  });

  test('skip link jumps to the main content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute('href', '#main');
  });
});

test.describe('theme', () => {
  test('toggle cycles device → light → dark and is remembered', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: /Theme: follow device/ }).click();
    await expect(page.getByRole('button', { name: /Theme: light/ })).toBeVisible();
    await page.getByRole('button', { name: /Theme: light/ }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: /Theme: dark/ })).toBeVisible();
  });

  test('follows the device setting by default', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('stall console', () => {
  test.use({ storageState: STORAGE.vendor });

  test('vendor console shows the stall switcher and its navigation', async ({ page, isMobile }) => {
    await page.goto('/vendor');
    await expect(page.getByRole('combobox', { name: 'Stall' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: "Today's orders" })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Stall console' }).filter({ visible: true });
    await nav.getByRole('link', { name: 'Menu' }).click();
    await expect(page).toHaveURL(/\/vendor\/menu$/);
    if (!isMobile)
      await expect(nav.getByRole('link', { name: 'Menu' })).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('stall switcher', () => {
  test.use({ storageState: STORAGE.vendor });

  test('lists only the stalls this owner was registered for, and remembers the choice', async ({ page }) => {
    await page.goto('/vendor');
    const picker = page.getByRole('combobox', { name: 'Stall' });
    await expect(picker.getByRole('option')).toHaveText(['Chai & Rolls', 'Dosa Corner']);
    await picker.selectOption({ label: 'Dosa Corner' });
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Stall' })).toHaveValue(
      (await page.getByRole('option', { name: 'Dosa Corner' }).getAttribute('value')) as string,
    );
  });
});

test.describe('admin console', () => {
  test.use({ storageState: STORAGE.admin });

  test('admin menu opens as a sheet on phones and closes with Escape', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'desktop shows a permanent sidebar');
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const dialog = page.getByRole('dialog', { name: 'Admin menu' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await dialog.getByRole('link', { name: 'Revenue' }).click();
    await expect(page).toHaveURL(/\/admin\/revenue$/);
    await expect(dialog).toBeHidden();
  });
});

test.describe('components', () => {
  test('tabs support arrow keys', async ({ page }) => {
    await page.goto('/dev/components');
    const tablist = page.getByRole('tablist', { name: 'Order board' });
    await tablist.getByRole('tab', { name: 'New (3)' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tablist.getByRole('tab', { name: 'Preparing (2)' })).toBeFocused();
    await expect(tablist.getByRole('tab', { name: 'Preparing (2)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('End');
    await expect(tablist.getByRole('tab', { name: 'Ready (1)' })).toHaveAttribute('aria-selected', 'true');
  });

  test('quantity stepper adds and removes, sold-out items cannot be added', async ({ page }) => {
    await page.goto('/dev/components');
    await page.getByRole('button', { name: 'Add Chicken Chowmein' }).click();
    const group = page.getByRole('group', { name: 'Quantity of Chicken Chowmein' });
    await expect(group).toContainText('1');
    await group.getByRole('button', { name: 'Add one more Chicken Chowmein' }).click();
    await expect(group).toContainText('2');
    await group.getByRole('button', { name: 'Remove one Chicken Chowmein' }).click();
    await group.getByRole('button', { name: 'Remove one Chicken Chowmein' }).click();
    await expect(page.getByRole('button', { name: 'Add Chicken Chowmein' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Paneer Dosa' })).toBeDisabled();
  });

  test('sheet traps focus and closes with Escape; toasts are announced', async ({ page }) => {
    await page.goto('/dev/components');
    await page.getByRole('button', { name: 'Open item details' }).click();
    const sheet = page.getByRole('dialog', { name: 'Masala Dosa' });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await page.getByRole('button', { name: 'Success toast' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Added Masala Dosa to your cart' }),
    ).toBeVisible();
  });

  test('phone field shows a readable error', async ({ page }) => {
    await page.goto('/dev/components');
    const field = page.getByRole('textbox', { name: 'Mobile number' });
    await field.fill('12345');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Enter a 10-digit mobile number')).toBeVisible();
  });
});

test('PWA manifest and icons are served', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ short_name: 'MOM', display: 'standalone', start_url: '/' });
  for (const icon of manifest.icons as { src: string }[]) {
    const res = await request.get(icon.src);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
  }
});

test('unknown pages show the not-found screen', async ({ page }) => {
  const res = await page.goto('/no-such-page');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: "This page doesn't exist" })).toBeVisible();
});
