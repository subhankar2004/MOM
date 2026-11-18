import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { addMenu, addStallMember, createTestStall, createUser } from './support/db';
import { PHONES } from './support/env';
import { signIn } from './support/session';

/**
 * Stall settings, with the stall owner in one browser and a student in another:
 * cash switched off disappears from checkout; changed hours flip the open/closed chip.
 */
test.describe.configure({ mode: 'serial' });

const project = () => test.info().project.name.replace(/[^a-z0-9]/g, '');
const desktop = () => project() === 'desktop';
const ownerState = () => `e2e/.auth/settings-owner-${test.info().project.name}.json`;
const studentState = () => `e2e/.auth/settings-student-${test.info().project.name}.json`;

test.beforeAll(async ({ browser }) => {
  const owner = desktop() ? PHONES.settingsVendorDesktop : PHONES.settingsVendor360;
  await createUser(owner, 'Settings Owner', 'vendor_owner');
  for (const [phone, name, file] of [
    [owner, 'Settings Owner', ownerState()],
    [desktop() ? PHONES.settingsDesktop : PHONES.settingsPhone360, 'Settings Student', studentState()],
  ] as const) {
    const ctx = await browser.newContext();
    await signIn(ctx, phone, name);
    await ctx.storageState({ path: file });
    await ctx.close();
  }
});

/** A browser page signed in from a saved state. */
async function pageAs(browser: Browser, file: string): Promise<Page> {
  const state = JSON.parse(readFileSync(file, 'utf8')) as {
    cookies: Parameters<BrowserContext['addCookies']>[0];
  };
  const ctx = await browser.newContext();
  await ctx.addCookies(state.cookies);
  await ctx.addInitScript(() => localStorage.setItem('mom.session', '1'));
  return ctx.newPage();
}

async function stallOwnedByOwner(base: string, options: Parameters<typeof createTestStall>[1]) {
  const slug = `e2e-${base}-${project()}`;
  const stallId = await createTestStall(slug, options);
  await addMenu(stallId, [['Snacks', [['Samosa', 20]]]]);
  await addStallMember(stallId, desktop() ? PHONES.settingsVendorDesktop : PHONES.settingsVendor360);
  return { slug, stallId };
}

test('turning cash off hides it at checkout immediately', async ({ browser }) => {
  const { slug } = await stallOwnedByOwner('settings-cash', { open: true, upi: true });
  const student = await pageAs(browser, studentState());
  await student.goto(`/stalls/${slug}`);
  await student.getByRole('button', { name: 'Add Samosa' }).click();
  await student.goto('/checkout');
  await expect(student.getByRole('radio', { name: /Pay cash at the counter/ })).toBeVisible();

  const owner = await pageAs(browser, ownerState());
  await owner.goto('/vendor/settings');
  const cash = owner.getByRole('switch', { name: 'Accept cash' });
  await expect(cash).toHaveAttribute('aria-checked', 'true');
  await cash.click();
  await expect(owner.getByText('Cash turned off')).toBeVisible();
  await expect(cash).toHaveAttribute('aria-checked', 'false');

  await student.reload();
  await expect(student.getByRole('radio', { name: /Pay now by UPI/ })).toBeVisible();
  // Cash can no longer be chosen; checkout says why (the option stays greyed out, not hidden).
  const cashOption = student.getByRole('radio', { name: /Pay cash at the counter/ });
  await expect(cashOption).toBeDisabled();
  await expect(student.getByText('Not accepted by this stall')).toBeVisible();
  await expect(student.getByRole('radio', { name: /Pay now by UPI/ })).toBeChecked();

  // UPI is the only way left to pay, so it can't be switched off too.
  await owner.getByRole('switch', { name: 'Accept UPI' }).click();
  await expect(owner.getByText(/Keep at least one payment method on/)).toBeVisible();
  await owner.context().close();
  await student.context().close();
});

test('changing the hours updates the open/closed chip', async ({ browser }) => {
  // No UPI account yet: the UPI switch explains why it's off.
  const { slug } = await stallOwnedByOwner('settings-hours', {});
  const owner = await pageAs(browser, ownerState());
  await owner.goto('/vendor/settings');
  // This owner has two test stalls: pick this one.
  await owner
    .getByRole('combobox', { name: 'Stall' })
    .selectOption({ label: `Test ${slug.replace(/^e2e-/, '')}` });
  const status = owner.getByRole('region', { name: 'Open or closed' });
  await expect(status.getByText('Closed', { exact: true })).toBeVisible();
  await expect(status.getByText(/No opening hours set/)).toBeVisible();
  await expect(owner.getByText(/Settlement account pending/)).toBeVisible();
  await expect(owner.getByRole('switch', { name: 'Accept UPI' })).toBeDisabled();

  // Open all day today (India time).
  const today = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' }).format(
    new Date(),
  );
  await owner.getByRole('button', { name: `Add hours on ${today}` }).click();
  await owner.getByLabel(`${today} opens`).fill('00:00');
  await owner.getByLabel(`${today} closes`).fill('23:59');
  await owner.getByRole('button', { name: 'Save hours' }).click();
  await expect(owner.getByText('Opening hours saved')).toBeVisible();
  await expect(status.getByText('Open', { exact: true })).toBeVisible();

  const visitor = await browser.newPage();
  await visitor.goto(`/stalls/${slug}`);
  await expect(visitor.getByText('Open', { exact: true })).toBeVisible();

  // "Closed now" overrides the hours until midnight.
  await status.getByRole('radio', { name: 'Closed now' }).click();
  await expect(status.getByText(/Closed by you/)).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByText('Closed', { exact: true })).toBeVisible();

  // Back to the hours; then pause new orders.
  await status.getByRole('radio', { name: 'Follow hours' }).click();
  await expect(status.getByText('Open', { exact: true })).toBeVisible();
  await owner.getByRole('switch', { name: 'Take new orders' }).click();
  await expect(status.getByText('Open, but not taking new orders.')).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByText('Paused', { exact: true })).toBeVisible();
  await visitor.close();
  await owner.context().close();
});
