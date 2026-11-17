import { expect, test, type Page } from '@playwright/test';
import { addMenu, createTestStall } from './support/db';

const unique = (base: string) => `${base}-${test.info().project.name.replace(/[^a-z0-9]/g, '')}`;
const row = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name });

async function openTestStall(page: Page, base: string, options: { open?: boolean; opensInMinutes?: number }) {
  const slug = `e2e-${unique(base)}`;
  const id = await createTestStall(slug, options);
  await addMenu(id, [
    [
      'Mains',
      [
        ['Veg Thali', 90],
        ['Fish Thali', 140],
        ['Mutton Thali', 220, false],
      ],
    ],
    [
      'Drinks',
      [
        ['Lassi', 40],
        ['Masala Chai', 15],
      ],
    ],
  ]);
  await page.goto(`/stalls/${slug}`);
  await expect(page.getByRole('heading', { level: 1, name: `Test ${unique(base)}` })).toBeVisible();
  return slug;
}

test('the menu shows categories, prices, veg marks and sold-out dishes that cannot be added', async ({
  page,
}) => {
  await page.goto('/stalls/dosa-corner');
  await expect(page.getByRole('heading', { level: 1, name: 'Dosa Corner' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Menu sections' });
  await expect(nav.getByRole('link')).toHaveText(['Dosa', 'Idli & Vada', 'Drinks']);
  await expect(row(page, 'Masala Dosa')).toContainText('₹60');
  await expect(row(page, 'Masala Dosa').getByRole('img', { name: 'Vegetarian' })).toBeVisible();

  // Acceptance: sold-out items can't be added
  const paneer = row(page, 'Paneer Dosa');
  await expect(paneer).toContainText('Sold out');
  await expect(paneer.getByRole('button', { name: 'Add Paneer Dosa' })).toBeDisabled();
});

test('adding dishes, changing quantity, and the detail sheet stay in sync', async ({ page }) => {
  await openTestStall(page, 'menu-add', { open: true });
  await page.getByRole('button', { name: 'Add Lassi' }).click();
  const qty = page.getByRole('group', { name: 'Quantity of Lassi' });
  await expect(qty).toContainText('1');
  await qty.getByRole('button', { name: 'Add one more Lassi' }).click();
  await expect(qty).toContainText('2');

  await page.getByRole('button', { name: 'Lassi', exact: true }).click(); // open details
  const sheet = page.getByRole('dialog', { name: 'Lassi' });
  await expect(sheet).toContainText('Fresh lassi');
  await expect(sheet.getByRole('group', { name: 'Quantity of Lassi' })).toContainText('2');
  await sheet.getByRole('button', { name: 'Add one more Lassi' }).click();
  await page.keyboard.press('Escape');
  await expect(qty).toContainText('3');

  await expect(row(page, 'Mutton Thali').getByRole('button', { name: 'Add Mutton Thali' })).toBeDisabled();
});

test('a closed stall can be browsed, but nothing can be added and a banner says why', async ({ page }) => {
  await openTestStall(page, 'menu-closed', { opensInMinutes: 90 });
  await expect(page.getByRole('status').filter({ hasText: 'Closed right now' })).toContainText(
    /Opens .* (AM|PM)/,
  );
  await expect(page.getByRole('button', { name: 'Add Veg Thali' })).toBeDisabled();
  await expect(row(page, 'Lassi')).toContainText('₹40'); // still browsable
});

test('category chips scroll to their section and follow the scroll', async ({ page }) => {
  await openTestStall(page, 'menu-nav', { open: true });
  const nav = page.getByRole('navigation', { name: 'Menu sections' });
  await expect(nav.getByRole('link', { name: 'Mains' })).toHaveAttribute('aria-current', 'true');
  await nav.getByRole('link', { name: 'Drinks' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Drinks/ })).toBeInViewport();
  await expect(nav.getByRole('link', { name: 'Drinks' })).toHaveAttribute('aria-current', 'true');
});

test('adding from a second stall asks before replacing the cart', async ({ page }) => {
  const first = await openTestStall(page, 'menu-cart-a', { open: true });
  await page.getByRole('button', { name: 'Add Lassi' }).click();
  void first;
  // Client-side navigation keeps the cart (saving across reloads arrives in #13)
  const secondSlug = `e2e-${unique('menu-cart-b')}`;
  const secondId = await createTestStall(secondSlug, { open: true });
  await addMenu(secondId, [['Snacks', [['Samosa', 20]]]]);
  await page.getByRole('link', { name: 'All stalls' }).click();
  await page.getByRole('link', { name: new RegExp(`Test ${unique('menu-cart-b')}`) }).click();
  await page.getByRole('button', { name: 'Add Samosa' }).click();

  const ask = page.getByRole('dialog', { name: 'Start a new cart?' });
  await expect(ask).toContainText(`Test ${unique('menu-cart-a')}`);
  await ask.getByRole('button', { name: 'Keep current cart' }).click();
  await expect(page.getByRole('button', { name: 'Add Samosa' })).toBeVisible();

  await page.getByRole('button', { name: 'Add Samosa' }).click();
  await page
    .getByRole('dialog', { name: 'Start a new cart?' })
    .getByRole('button', { name: 'Start new cart' })
    .click();
  await expect(page.getByRole('group', { name: 'Quantity of Samosa' })).toContainText('1');
});

test('an unknown stall shows a friendly not-found page', async ({ page }) => {
  await page.goto('/stalls/no-such-stall');
  await expect(page.getByRole('heading', { level: 1, name: "This stall isn't on MOM" })).toBeVisible();
  await expect(page.getByRole('link', { name: 'See all stalls' })).toBeVisible();
});

test('a 50-dish menu scrolls smoothly on a mid-range phone (4x slower CPU)', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'CPU throttling needs Chromium');
  const slug = `e2e-${unique('menu-big')}`;
  const id = await createTestStall(slug, { open: true });
  await addMenu(
    id,
    ['Starters', 'Mains', 'Rice', 'Breads', 'Desserts'].map((cat) => [
      cat,
      Array.from({ length: 10 }, (_, i) => [`${cat} dish ${i + 1}`, 30 + i * 10] as [string, number]),
    ]),
  );
  await page.goto(`/stalls/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Add / })).toHaveCount(50);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => {
    (window as unknown as { longTasks: number[] }).longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        (window as unknown as { longTasks: number[] }).longTasks.push(e.duration);
    }).observe({ type: 'longtask', buffered: false });
  });

  // Scroll the whole menu in small steps, like a thumb flick.
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(16);
  }
  await expect(page.getByRole('button', { name: 'Add Desserts dish 10' })).toBeInViewport();
  const longTasks = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  // No single freeze a person would notice, and little main-thread blocking overall.
  expect(Math.max(0, ...longTasks), `long tasks: ${longTasks.join(', ')}`).toBeLessThan(150);
  expect(longTasks.reduce((sum, d) => sum + Math.max(0, d - 50), 0)).toBeLessThan(300);
});
