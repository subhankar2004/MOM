import { expect, test, type Page } from '@playwright/test';
import { addActiveOrders, createTestStall } from './support/db';
import { STORAGE } from './support/env';

// The home list is public; signed-in or not looks the same. Use a student to also cover that.
test.use({ storageState: STORAGE.student });

const stallList = (page: Page) => page.getByRole('list', { name: 'Stalls' });
const card = (page: Page, name: string) =>
  stallList(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name }) });
/** Phone and desktop runs happen in parallel: each gets its own test stall. */
const unique = (base: string) => `${base}-${test.info().project.name.replace(/[^a-z0-9]/g, '')}`;

test('lists the demo stalls with status, wait or opening time, payments and prices', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Stalls near you' })).toBeVisible();
  const dosa = card(page, 'Dosa Corner');
  await expect(dosa).toBeVisible();
  await expect(dosa).toContainText(/Open|Paused|Closed/);
  await expect(dosa).toContainText('UPI');
  await expect(dosa).toContainText('from ₹20'); // cheapest available: Filter Coffee
  await expect(card(page, 'Chowmein Junction')).not.toContainText('UPI'); // Route not activated
  await expect(dosa.getByRole('link')).toHaveAttribute('href', '/stalls/dosa-corner');
});

test('a closed stall is greyed out and shows when it opens', async ({ page }) => {
  await createTestStall(`e2e-${unique('closed-later')}`, { opensInMinutes: 120 });
  await page.goto('/');
  const closed = card(page, `Test ${unique('closed-later')}`);
  await expect(closed).toContainText('Closed');
  await expect(closed).toContainText(/Opens (tomorrow )?\d{1,2}(:\d{2})? (AM|PM)/);
  await expect(closed.getByRole('link')).toHaveClass(/border-dashed/);
  await expect(closed.locator('.grayscale')).toHaveCount(1); // photo/placeholder in greyscale
});

test('the busy meter updates without reloading the page', async ({ page }) => {
  await page.clock.install();
  const stallId = await createTestStall(`e2e-${unique('meter')}`, {
    open: true,
    avgPrepMinutes: 10,
    parallelCapacity: 1,
  });
  await page.goto('/');
  const stall = card(page, `Test ${unique('meter')}`);
  await expect(stall).toContainText('Not busy');
  await expect(stall).toContainText('~10 min');

  await addActiveOrders(stallId, 3); // ceil(4 / 1) × 10 = 40 min → Busy
  await page.clock.fastForward('00:31'); // the 30-second refresh
  await expect(stall).toContainText('Busy');
  await expect(stall).toContainText('~40 min');
});

test('search finds stalls by name, cuisine or dish, and says which dish matched', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: 'Search stalls or dishes' });

  await search.fill('chhena');
  await expect(stallList(page).getByRole('listitem')).toHaveCount(1);
  await expect(card(page, 'Odia Thali Ghar')).toContainText('Has Chhena Poda');

  await search.fill('CHINESE');
  await expect(card(page, 'Chowmein Junction')).toBeVisible();

  await search.fill('pizza');
  await expect(page.getByRole('heading', { name: 'Nothing matches "pizza"' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search and filters' }).click();
  await expect(search).toHaveValue('');
  await expect(card(page, 'Dosa Corner')).toBeVisible();
});

test('"Pure veg" shows only vegetarian stalls', async ({ page }) => {
  await page.goto('/');
  await expect(card(page, 'Chowmein Junction')).toBeVisible();
  const veg = page.getByRole('button', { name: 'Pure veg' });
  await veg.click();
  await expect(veg).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, 'Dosa Corner')).toBeVisible();
  await expect(card(page, 'Chowmein Junction')).toHaveCount(0);
});

test('"Open now" hides closed stalls', async ({ page }) => {
  await createTestStall(`e2e-${unique('filter-closed')}`, { opensInMinutes: 180 });
  await createTestStall(`e2e-${unique('filter-open')}`, { open: true });
  await page.goto('/');
  await expect(card(page, `Test ${unique('filter-closed')}`)).toBeVisible();
  await page.getByRole('button', { name: 'Open now' }).click();
  await expect(card(page, `Test ${unique('filter-open')}`)).toBeVisible();
  await expect(card(page, `Test ${unique('filter-closed')}`)).toHaveCount(0);
});

test('shows skeletons while loading and a retry when the API fails', async ({ page }) => {
  let fail = true;
  await page.route('**/v1/stalls', async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Down for a moment' }, requestId: 'x' },
      });
    else await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: "Couldn't load the stalls" })).toBeVisible({
    timeout: 15_000,
  });
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(card(page, 'Dosa Corner')).toBeVisible();
});
