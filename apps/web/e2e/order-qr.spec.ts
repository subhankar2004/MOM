import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { addMenu, createTestStall } from './support/db';
import { PHONES } from './support/env';
import { signIn } from './support/session';

const unique = (base: string) => `${base}-${test.info().project.name.replace(/[^a-z0-9]/g, '')}`;

test.describe.configure({ mode: 'serial' });
const stateFile = () => `e2e/.auth/qr-${test.info().project.name}.json`;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context, test.info().project.name === 'desktop' ? PHONES.qrDesktop : PHONES.qrPhone360);
  await context.storageState({ path: stateFile() });
  await context.close();
});
test.beforeEach(async ({ context }) => {
  const state = JSON.parse(readFileSync(stateFile(), 'utf8')) as {
    cookies: Parameters<typeof context.addCookies>[0];
  };
  await context.addCookies(state.cookies);
  await context.addInitScript(() => localStorage.setItem('mom.session', '1'));
});

for (const theme of ['light', 'dark'] as const) {
  test(`token screen (${theme}): the QR code decodes to this order's signed payload`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('mom.theme', t), theme);
    const slug = `e2e-${unique(`qr-${theme}`)}`;
    const stallId = await createTestStall(slug, { open: true });
    await addMenu(stallId, [['Snacks', [['Samosa', 20]]]]);
    await page.goto(`/stalls/${slug}`);
    await page.getByRole('button', { name: 'Add Samosa' }).click();
    await page.goto('/checkout');
    await page.getByRole('button', { name: /^Place order/ }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    const orderId = page.url().split('/').pop()!;

    // Big token + status stepper
    await expect(page.getByRole('img', { name: /^Token 1 at/ })).toBeVisible();
    const steps = page.getByRole('list', { name: 'Order progress' });
    await expect(steps.locator('[aria-current="step"]')).toContainText('Placed');

    // Acceptance: the QR can be scanned — decode a real screenshot of it as shown on the phone.
    const qr = page.getByRole('img', { name: 'Pickup QR code for token 1' });
    await expect(qr).toBeVisible();
    const box = await qr.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(200); // ≈ 5–6 cm on a phone screen
    const png = PNG.sync.read(await qr.locator('xpath=..').screenshot());
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(decoded?.data).toMatch(new RegExp(`^MOM1\\.${orderId}\\.[A-Za-z0-9_-]{22}$`));
    expect(decoded!.version).toBeLessThanOrEqual(5); // few, large modules → quick scan from a distance
  });
}
