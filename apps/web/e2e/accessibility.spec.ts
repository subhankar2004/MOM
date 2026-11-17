import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { STORAGE } from './support/env';

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => localStorage.setItem('mom.theme', t), theme);
}

async function checkPage(page: Page, path: string, theme: 'light' | 'dark', ready: RegExp) {
  await setTheme(page, theme);
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.getByRole('heading', { level: 1, name: ready })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page is wider than the screen').toBeLessThanOrEqual(0);
}

const PUBLIC: Array<[string, RegExp]> = [
  ['/', /Stalls near you/],
  ['/login', /Sign in to order/],
  ['/no-access', /No access/],
  ['/dev/components', /Design system/],
];

// Signed in as the super admin, who can open every area.
const SIGNED_IN: Array<[string, RegExp]> = [
  ['/orders', /Your orders/],
  ['/profile', /Profile/],
  ['/vendor', /Today's orders/],
  ['/vendor/menu', /Menu/],
  ['/admin', /Overview/],
  ['/admin/stalls', /Stalls/],
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    for (const [path, ready] of PUBLIC) {
      test(`${path} has no WCAG 2.1 AA violations and no sideways scroll`, async ({ page }) => {
        await checkPage(page, path, theme, ready);
      });
    }

    test.describe('signed in', () => {
      test.use({ storageState: STORAGE.admin });
      for (const [path, ready] of SIGNED_IN) {
        test(`${path} has no WCAG 2.1 AA violations and no sideways scroll`, async ({ page }) => {
          await checkPage(page, path, theme, ready);
        });
      }
    });
  });
}
