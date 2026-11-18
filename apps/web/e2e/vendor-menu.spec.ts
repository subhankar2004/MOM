import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { addStallMember, createTestStall, createUser } from './support/db';
import { PHONES, WEB_URL } from './support/env';
import { signIn } from './support/session';

/**
 * The menu editor: a stall owner builds a menu with a photo, and students see it.
 * Photos really go through the browser compressor and a presigned upload to S3 (SeaweedFS).
 */
test.describe.configure({ mode: 'serial' });

const project = () => test.info().project.name.replace(/[^a-z0-9]/g, '');
const stateFile = () => `e2e/.auth/menu-${test.info().project.name}.json`;
let slug: string;
let stallId: string;

/** A real PNG (solid saffron), big enough that compression has to shrink it to 1200 px. */
function pngPhoto(width = 1600, height = 1200): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, Buffer.from([0xf2, 0x9a, 0x2e]))]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test.beforeAll(async ({ browser }) => {
  slug = `e2e-menu-${project()}`;
  stallId = await createTestStall(slug, { open: true });
  const owner = project() === 'desktop' ? PHONES.menuVendorDesktop : PHONES.menuVendor360;
  await createUser(owner, 'Menu Owner', 'vendor_owner');
  await addStallMember(stallId, owner);
  const ctx = await browser.newContext();
  await signIn(ctx, owner, 'Menu Owner');
  await ctx.storageState({ path: stateFile() });
  await ctx.close();
});

test.beforeEach(async ({ context }) => {
  const state = JSON.parse(readFileSync(stateFile(), 'utf8')) as {
    cookies: Parameters<typeof context.addCookies>[0];
  };
  await context.addCookies(state.cookies);
  await context.addInitScript(() => localStorage.setItem('mom.session', '1'));
});

test('an owner adds a dish with a photo and students see it', async ({ page, browser }) => {
  await page.goto('/vendor/menu');
  await expect(page.getByRole('heading', { name: 'Start your menu' })).toBeVisible();

  await page.getByRole('button', { name: 'Add a category' }).click();
  await page.getByLabel('Category name').fill('Tiffin');
  await page.getByRole('button', { name: 'Add category' }).last().click();
  await expect(page.getByRole('heading', { name: 'Tiffin' })).toBeVisible();

  await page.getByRole('button', { name: 'Add dish to Tiffin' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a dish' });
  // Trying to save an empty form explains what's missing.
  await sheet.getByRole('button', { name: 'Add dish' }).click();
  await expect(sheet.getByText('Give the dish a name')).toBeVisible();
  await expect(sheet.getByText('Enter a price')).toBeVisible();

  const upload = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().includes('/mom-images/'),
  );
  await sheet
    .getByLabel('Photo', { exact: true })
    .setInputFiles({ name: 'dosa.png', mimeType: 'image/png', buffer: pngPhoto() });
  expect((await upload).status()).toBe(200);
  const preview = sheet.getByRole('img', { name: 'Dish photo preview' });
  await expect(preview).toHaveAttribute(
    'src',
    new RegExp(`/stalls/${stallId}/items/[0-9a-f-]+\\.(webp|jpg)$`),
  );
  // Compressed in the browser: at most 1200 px wide.
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1200);

  await sheet.getByLabel('Name').fill('Ghee Roast Dosa');
  await sheet.getByLabel('Price').fill('85');
  await sheet.getByLabel('Description (optional)').fill('Crisp, with coconut chutney');
  await sheet.getByRole('button', { name: 'Add dish' }).click();
  await expect(page.getByText('Ghee Roast Dosa added')).toBeVisible();
  const row = page.getByRole('listitem', { name: 'Ghee Roast Dosa' });
  await expect(row).toContainText('₹85');

  // A student (signed out, another browser) sees the dish with its photo.
  const visitor = await browser.newPage();
  await visitor.goto(`${WEB_URL}/stalls/${slug}`);
  await expect(visitor.getByRole('button', { name: 'Ghee Roast Dosa', exact: true })).toBeVisible();
  const photo = visitor.locator(`img[src*="/stalls/${stallId}/items/"]`).first();
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await visitor.close();
});

test('an owner marks a dish sold out, edits its price and brings everything back', async ({ page }) => {
  await page.goto('/vendor/menu');
  const toggle = page.getByRole('switch', { name: 'Ghee Roast Dosa available' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('1 dish, 1 sold out')).toBeVisible();

  await page
    .getByRole('button', { name: /Ghee Roast Dosa/ })
    .first()
    .click();
  const sheet = page.getByRole('dialog', { name: 'Edit dish' });
  await sheet.getByLabel('Price').fill('90');
  await sheet.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('listitem', { name: 'Ghee Roast Dosa' })).toContainText('₹90');

  await page.getByRole('button', { name: 'Mark all available' }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Mark all available' })).toBeHidden();
});
