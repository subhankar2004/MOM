import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PAGES = [
  '/',
  '/orders',
  '/profile',
  '/vendor',
  '/vendor/menu',
  '/admin',
  '/admin/stalls',
  '/dev/components',
];

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => localStorage.setItem('mom.theme', t), theme);
}

for (const theme of ['light', 'dark'] as const) {
  for (const path of PAGES) {
    test(`${path} (${theme}) has no WCAG 2.1 AA violations and no sideways scroll`, async ({ page }) => {
      await setTheme(page, theme);
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const summary = results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
      );
      expect(summary).toEqual([]);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, 'page is wider than the screen').toBeLessThanOrEqual(0);
    });
  }
}
