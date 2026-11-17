import { expect, test, type Page } from '@playwright/test';
import { createUser } from './support/db';
import { PHONES, STORAGE, TEST_CODE } from './support/env';

/** Types the national number (without +91) the way a person would. */
const national = (e164: string) => `${e164.slice(3, 8)} ${e164.slice(8)}`;

async function enterPhone(page: Page, phone: string) {
  await page.getByRole('textbox', { name: 'Mobile number' }).fill(national(phone));
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
}

async function typeCode(page: Page, code: string) {
  // Focus starts in the first box; typing digit by digit moves along the boxes.
  await page.getByRole('textbox', { name: 'Digit 1 of 6' }).focus();
  await page.keyboard.type(code);
}

// Each login test uses its own phone and runs once (phone project), so the 30-second
// resend cooldown never collides between parallel tests.
test.describe('signing in', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(!isMobile, 'login flow tested once, on the phone viewport');
  });

  test('new student: phone → code → name → back to the page they wanted', async ({ page }) => {
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login\?next=%2Forders$/);
    await enterPhone(page, PHONES.flowNew);
    await typeCode(page, TEST_CODE); // 6th digit submits automatically
    await expect(page.getByRole('heading', { name: "What's your name?" })).toBeVisible();
    await page.getByRole('textbox', { name: 'Your name' }).fill('Asha Mohanty');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Your orders' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Your profile, Asha Mohanty' })).toBeVisible();
  });

  test('login from the sign-in button lands on the home page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await enterPhone(page, PHONES.flowHome);
    await typeCode(page, TEST_CODE);
    await page.getByRole('textbox', { name: 'Your name' }).fill('Ravi');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Stalls near you' })).toBeVisible();
  });

  test('a wrong code shows how many tries are left; the right one then works', async ({ page }) => {
    await page.goto('/login');
    await enterPhone(page, PHONES.flowWrong);
    await typeCode(page, '000000');
    await expect(page.getByRole('alert').filter({ hasText: 'tries left' })).toHaveText(
      'That code is not right. 4 tries left.',
    );
    await expect(page.getByRole('textbox', { name: 'Digit 1 of 6' })).toHaveValue(''); // boxes cleared
    await expect(page.getByText(/ask for a new code in \d+s/)).toBeVisible(); // resend timer
    await typeCode(page, TEST_CODE);
    await expect(page.getByRole('heading', { name: "What's your name?" })).toBeVisible();
  });

  test('pasting the SMS text fills all six boxes', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/login');
    await enterPhone(page, PHONES.flowPaste);
    await page.evaluate(
      (code) => navigator.clipboard.writeText(`${code} is your MOM login code.`),
      TEST_CODE,
    );
    await page.getByRole('textbox', { name: 'Digit 1 of 6' }).focus();
    await page.keyboard.press('ControlOrMeta+V');
    await expect(page.getByRole('heading', { name: "What's your name?" })).toBeVisible();
  });

  test('"Change number" goes back to the phone step', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Mobile number' }).fill('123');
    await expect(page.getByRole('button', { name: 'Send code' })).toBeDisabled();
    await enterPhone(page, PHONES.flowChange);
    await page.getByRole('button', { name: 'Change number' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to order' })).toBeVisible();
  });

  test('an expired access token is renewed silently', async ({ page, context }) => {
    await page.goto('/login');
    await enterPhone(page, PHONES.flowRefresh);
    await typeCode(page, TEST_CODE);
    await page.getByRole('textbox', { name: 'Your name' }).fill('Refresh Test');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/$/);

    // Drop the 15-minute access cookie, as if it had expired; keep the refresh cookie.
    const cookies = await context.cookies();
    await context.clearCookies();
    await context.addCookies(cookies.filter((c) => c.name !== 'mom_at'));
    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
    await expect(page.getByText('Refresh Test')).toBeHidden(); // name is in the input, not text
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Refresh Test');
    expect((await context.cookies()).some((c) => c.name === 'mom_at')).toBe(true); // renewed
  });
  test('an existing admin signing in lands on /admin', async ({ page }) => {
    await createUser(PHONES.flowAdmin, 'Second Admin', 'super_admin');
    await page.goto('/login');
    await enterPhone(page, PHONES.flowAdmin);
    await typeCode(page, TEST_CODE); // named already → no name step
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  });
});

test('signed-out visitors browse without any session calls to the API', async ({ page }) => {
  const sessionCalls: string[] = [];
  page.on('request', (r) => {
    if (/\/v1\/(me|auth\/refresh)/.test(r.url())) sessionCalls.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.goto('/dev/components');
  await expect(page.getByRole('heading', { level: 1, name: 'Design system' })).toBeVisible();
  expect(sessionCalls).toEqual([]);
});

test.describe('who can open what', () => {
  test('signed-out visitors to the stall console are sent to sign in', async ({ page }) => {
    await page.goto('/vendor');
    await expect(page).toHaveURL(/\/login\?next=%2Fvendor$/);
  });

  test.describe('as a student', () => {
    test.use({ storageState: STORAGE.student });

    test('/admin redirects to "No access"', async ({ page }) => {
      await page.goto('/admin');
      await expect(page).toHaveURL(/\/no-access\?from=%2Fadmin$/);
      await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();
    });

    test('/vendor redirects to "No access"', async ({ page }) => {
      await page.goto('/vendor/menu');
      await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();
    });

    test('the login page sends an already signed-in student home', async ({ page }) => {
      await page.goto('/login');
      await expect(page).toHaveURL(/\/$/);
    });
  });

  test.describe('as a stall owner', () => {
    test.use({ storageState: STORAGE.vendor });

    test('opens the stall console but not admin', async ({ page }) => {
      await page.goto('/vendor');
      await expect(page.getByRole('heading', { level: 1, name: "Today's orders" })).toBeVisible();
      await page.goto('/admin');
      await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();
    });
  });

  test.describe('as the super admin', () => {
    test.use({ storageState: STORAGE.admin });

    test('opens admin and the stall console', async ({ page }) => {
      await page.goto('/admin');
      await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
      await page.goto('/vendor');
      await expect(page.getByRole('heading', { level: 1, name: "Today's orders" })).toBeVisible();
    });
  });
});

test.describe('signing out', () => {
  test('from the profile page', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'runs once');
    await page.goto('/login');
    await enterPhone(page, PHONES.flowSignOut);
    await typeCode(page, TEST_CODE);
    await page.getByRole('textbox', { name: 'Your name' }).fill('Sign Out');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login/);
  });
});
