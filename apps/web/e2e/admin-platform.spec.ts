import { expect, test } from '@playwright/test';
import { STORAGE } from './support/env';

/**
 * Platform settings and the audit log. Settings are global and other tests run at the same
 * time, so this runs once (desktop), changes only the cash no-show limit, and puts it back.
 */
test.describe.configure({ mode: 'serial' });
test.use({ storageState: STORAGE.admin });
test.beforeEach(async ({ context, isMobile }) => {
  test.skip(isMobile, 'global settings are changed once, on desktop');
  await context.addInitScript(() => localStorage.setItem('mom.session', '1'));
});

test('a settings change is saved and shows in the audit log with before and after', async ({ page }) => {
  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByText(/On a ₹100 order: UPI ₹101\.00/)).toBeVisible();

  // The preview follows the form.
  const fee = page.getByLabel('Platform fee, % (every order)');
  await fee.fill('2');
  await expect(page.getByText(/On a ₹100 order: UPI ₹102\.00/)).toBeVisible();
  await fee.fill('1');

  const limit = page.getByLabel('Cash no-shows before cash is blocked');
  const original = await limit.inputValue();
  const changed = String(Number(original) + 1);
  await limit.fill(changed);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  await page.goto('/admin/audit');
  await page.getByLabel('Action starts with').fill('platform.settings.change');
  const entry = page.getByRole('listitem').filter({ hasText: 'platform.settings.change' }).first();
  await expect(entry).toBeVisible();
  await entry.getByText(/Before and after/).click();
  const row = entry.getByRole('row', { name: /cashStrikeLimit/ });
  await expect(row).toContainText(original);
  await expect(row).toContainText(changed);

  // Put it back.
  await page.goto('/admin/settings');
  await page.getByLabel('Cash no-shows before cash is blocked').fill(original);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
});

test('a fee change can be scheduled for later and cancelled', async ({ page }) => {
  await page.goto('/admin/settings');
  await page.getByLabel('Platform fee, % (every order)').fill('1.5');
  await page.getByRole('radio', { name: /Later/ }).check();
  const tomorrow = new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Date').fill(tomorrow);
  await page.getByRole('button', { name: 'Schedule change' }).click();
  await expect(page.getByText('Change scheduled')).toBeVisible();

  const scheduled = page.getByRole('heading', { name: 'Scheduled' }).locator('..');
  await expect(scheduled).toContainText('platform fee 1.5%');
  // Today's fee is unchanged.
  await expect(page.getByText(/On a ₹100 order: UPI ₹101\.00/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeDisabled();

  await scheduled.getByRole('button', { name: 'Cancel change' }).click();
  await scheduled.getByRole('button', { name: 'Confirm cancel' }).click();
  await expect(page.getByText('Scheduled change cancelled')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Scheduled' })).toBeHidden();
});
