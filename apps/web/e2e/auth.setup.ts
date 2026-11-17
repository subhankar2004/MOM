import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request, test as setup, type APIResponse } from '@playwright/test';
import { resetTestUsers } from './support/db';
import { API_URL, apiEnv, PHONES, STORAGE, TEST_CODE, WEB_URL } from './support/env';

/**
 * Runs once before the browser tests: migrates and seeds the test database, retires old
 * test accounts, and signs in an admin, a stall owner and a student through the real API
 * — exercising the super-admin bootstrap and stall-owner pre-registration on the way —
 * saving their cookies for the tests to reuse.
 */
setup('database and signed-in users', async () => {
  const env = { ...process.env, ...apiEnv() };
  execSync('npm run db:migrate -w @mom/api', { cwd: '../..', env, stdio: 'pipe' });
  execSync('npm run db:seed -w @mom/api', { cwd: '../..', env, stdio: 'pipe' }); // demo stalls
  await resetTestUsers();
  mkdirSync('e2e/.auth', { recursive: true });

  async function signIn(phone: string, name: string, file: string) {
    const api = await request.newContext({ baseURL: API_URL, extraHTTPHeaders: { origin: WEB_URL } });
    await ok(await api.post('/v1/auth/otp/request', { data: { phone } }));
    const verified = await api.post('/v1/auth/otp/verify', { data: { phone, code: TEST_CODE } });
    await ok(verified);
    await ok(await api.patch('/v1/me', { data: { name } }));
    // Cookies come from the API; the web app also keeps a "has signed in" hint in localStorage.
    const state = await api.storageState();
    writeFileSync(
      file,
      JSON.stringify({
        ...state,
        origins: [{ origin: WEB_URL, localStorage: [{ name: 'mom.session', value: '1' }] }],
      }),
    );
    return { api, role: (await verified.json()).user.role as string };
  }

  // 1. The admin's number is in SUPER_ADMIN_PHONES: signing in makes them super admin.
  const admin = await signIn(PHONES.admin, 'Test Admin', STORAGE.admin);
  if (admin.role !== 'super_admin') throw new Error(`admin bootstrap failed: role ${admin.role}`);

  // 2. The admin registers the vendor's number for two demo stalls (pre-registration).
  const stalls = (await (await admin.api.get('/v1/vendor/stalls')).json()).stalls as Array<{
    id: string;
    slug: string;
  }>;
  for (const slug of ['dosa-corner', 'chai-and-rolls']) {
    const stall = stalls.find((s) => s.slug === slug);
    if (!stall) throw new Error(`demo stall ${slug} missing`);
    await ok(
      await admin.api.post(`/v1/admin/stalls/${stall.id}/members`, { data: { phone: PHONES.vendor } }),
    );
  }

  // 3. The vendor signs in for the first time and becomes vendor_owner automatically.
  const vendor = await signIn(PHONES.vendor, 'Test Vendor', STORAGE.vendor);
  if (vendor.role !== 'vendor_owner') throw new Error(`pre-registration failed: role ${vendor.role}`);

  const student = await signIn(PHONES.student, 'Test Student', STORAGE.student);
  if (student.role !== 'student') throw new Error(`student role ${student.role}`);

  await Promise.all([admin.api.dispose(), vendor.api.dispose(), student.api.dispose()]);
});

async function ok(res: APIResponse) {
  if (!res.ok()) throw new Error(`${res.url()} → ${res.status()} ${await res.text()}`);
}
