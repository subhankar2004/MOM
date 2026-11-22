import { expect, test, type Page } from '@playwright/test';
import { addStallMember, createTestStall, createUser } from './support/db';
import { PHONES, TEST_CODE } from './support/env';

/**
 * Separate sign-in pages: /login (students), /vendor/login (stall accounts), /admin/login
 * (MOM admins). Each area sends signed-out visitors to its own page, and the stall page lets
 * in only numbers registered to a stall.
 */
test.describe.configure({ mode: 'serial' });
test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, 'sign-in flows run once (phone), like the other login tests');
});

const national = (e164: string) => `${e164.slice(3, 8)} ${e164.slice(8)}`;

async function signInOn(page: Page, path: string, phone: string) {
  await page.goto(path);
  await page.getByRole('textbox', { name: 'Mobile number' }).fill(national(phone));
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByRole('textbox', { name: 'Digit 1 of 6' }).focus();
  await page.keyboard.type(TEST_CODE);
}

test('each console sends signed-out visitors to its own sign-in page', async ({ page }) => {
  await page.goto('/vendor/menu');
  await expect(page).toHaveURL(/\/vendor\/login\?next=%2Fvendor%2Fmenu$/);
  await expect(page.getByRole('heading', { name: 'Stall console' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ordering food? Sign in as a student' })).toBeVisible();

  await page.goto('/admin/stalls');
  await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Fstalls$/);
  await expect(page.getByRole('heading', { name: 'MOM admin' })).toBeVisible();

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to order' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Run a stall? Sign in to the stall console' })).toBeVisible();
});

test("the stall page refuses a student's number and points to the student page", async ({ page }) => {
  await createUser(PHONES.portalStudent, 'Portal Student', 'student');
  await signInOn(page, '/vendor/login', PHONES.portalStudent);
  await expect(page.getByText(/isn't registered for a stall/)).toBeVisible();
  await page.getByRole('link', { name: 'Ordering food? Sign in as a student' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('a registered stall owner signs in on the stall page and lands in the console', async ({ page }) => {
  const stallId = await createTestStall('e2e-portal-stall', { open: true });
  await createUser(PHONES.portalOwner, 'Portal Owner', 'vendor_owner');
  await addStallMember(stallId, PHONES.portalOwner);
  await signInOn(page, '/vendor/login', PHONES.portalOwner);
  await expect(page).toHaveURL(/\/vendor$/);
  await expect(page.getByRole('heading', { name: "Today's orders" })).toBeVisible();

  // Signing out returns to the stall sign-in page.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/vendor\/login$/);
});
