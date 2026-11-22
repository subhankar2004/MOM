import { expect, test } from '@playwright/test';
import { PHONES, STORAGE, TEST_CODE } from './support/env';

/**
 * Onboarding (acceptance): the admin creates a stall and registers the owner's phone in the
 * admin console; that phone then signs in and lands in the stall's console.
 */
const project = () => test.info().project.name.replace(/[^a-z0-9]/g, '');
const national = (e164: string) => `${e164.slice(3, 8)} ${e164.slice(8)}`;

test('admin creates a stall and registers the owner, who signs in to its console', async ({ browser }) => {
  const stallName = `E2E Onboard ${project()}`;
  const ownerPhone = project() === 'desktop' ? PHONES.onboardOwnerDesktop : PHONES.onboardOwner360;

  const adminCtx = await browser.newContext({ storageState: STORAGE.admin });
  await adminCtx.addInitScript(() => localStorage.setItem('mom.session', '1'));
  const admin = await adminCtx.newPage();
  await admin.goto('/admin/stalls');
  await admin.getByRole('button', { name: 'Add stall' }).click();
  const sheet = admin.getByRole('dialog', { name: 'Add a stall' });
  await sheet.getByLabel('Stall name').fill(stallName);
  await sheet.getByLabel('Where is it?').fill('Near the library gate');
  await sheet.getByRole('button', { name: 'Add stall' }).click();

  // Straight to the new stall: a draft, with its go-live checklist.
  await expect(admin.getByRole('heading', { name: stallName, level: 1 })).toBeVisible();
  await expect(admin.getByText('Draft', { exact: true })).toBeVisible();
  await expect(admin.getByRole('heading', { name: 'Ready to go live: 1 of 5' })).toBeVisible();

  const owners = admin.getByRole('region', { name: 'Owner & staff' });
  await owners.getByLabel('Phone number').fill(national(ownerPhone));
  await owners.getByRole('button', { name: 'Register' }).click();
  await expect(admin.getByText(/registered: they get access when they sign in/)).toBeVisible();
  await expect(owners).toContainText("hasn't signed in yet");
  await expect(admin.getByRole('heading', { name: 'Ready to go live: 2 of 5' })).toBeVisible();

  // Going live too early says what's missing.
  await admin.getByRole('button', { name: 'Go live' }).click();
  await expect(
    admin.getByText(/Before going live, add a dish on the menu, opening hours and a stall photo/),
  ).toBeVisible();

  // The list shows it.
  await admin.getByRole('link', { name: 'All stalls' }).click();
  await admin.getByLabel('Search').fill(stallName);
  await expect(admin.getByRole('link', { name: new RegExp(stallName) })).toBeVisible();
  await adminCtx.close();

  // The owner signs in on their own phone.
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  // Stall owners use the stall console's own sign-in page.
  await owner.goto('/vendor/login');
  await owner.getByRole('textbox', { name: 'Mobile number' }).fill(national(ownerPhone));
  await owner.getByRole('button', { name: 'Send code' }).click();
  await owner.getByRole('textbox', { name: 'Digit 1 of 6' }).focus();
  await owner.keyboard.type(TEST_CODE);
  await owner.getByRole('textbox', { name: 'Your name' }).fill('Onboard Owner');
  await owner.getByRole('button', { name: 'Continue' }).click();
  await expect(owner).toHaveURL(/\/vendor$/);
  await expect(owner.getByText(stallName).first()).toBeVisible();
  await expect(owner.getByRole('heading', { name: "Today's orders" })).toBeVisible();
  await ownerCtx.close();
});
