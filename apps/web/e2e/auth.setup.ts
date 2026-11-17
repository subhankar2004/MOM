import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request, test as setup } from '@playwright/test';
import { resetTestUsers, setRole } from './support/db';
import { API_URL, E2E_DATABASE_URL, PHONES, STORAGE, TEST_CODE, WEB_URL } from './support/env';

/**
 * Runs once before the browser tests: migrates the test database, removes old test
 * accounts, and signs in one student, one stall owner and one admin through the real
 * API, saving their cookies for the tests to reuse.
 */
setup('database and signed-in users', async () => {
  execSync('npm run db:migrate -w @mom/api', {
    cwd: '../..',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: 'pipe',
  });
  await resetTestUsers();
  mkdirSync('e2e/.auth', { recursive: true });

  const people = [
    { phone: PHONES.student, name: 'Test Student', role: 'student', file: STORAGE.student },
    { phone: PHONES.vendor, name: 'Test Vendor', role: 'vendor_owner', file: STORAGE.vendor },
    { phone: PHONES.admin, name: 'Test Admin', role: 'super_admin', file: STORAGE.admin },
  ] as const;

  for (const p of people) {
    const api = await request.newContext({ baseURL: API_URL, extraHTTPHeaders: { origin: WEB_URL } });
    const ok = async (res: Awaited<ReturnType<typeof api.post>>) => {
      if (!res.ok()) throw new Error(`${res.url()} → ${res.status()} ${await res.text()}`);
    };
    await ok(await api.post('/v1/auth/otp/request', { data: { phone: p.phone } }));
    await ok(await api.post('/v1/auth/otp/verify', { data: { phone: p.phone, code: TEST_CODE } }));
    await ok(await api.patch('/v1/me', { data: { name: p.name } }));
    if (p.role !== 'student') {
      await setRole(p.phone, p.role);
      await ok(await api.post('/v1/auth/refresh')); // new access token carrying the new role
    }
    // Cookies come from the API; the web app also keeps a "has signed in" hint in localStorage.
    const state = await api.storageState();
    writeFileSync(
      p.file,
      JSON.stringify({
        ...state,
        origins: [{ origin: WEB_URL, localStorage: [{ name: 'mom.session', value: '1' }] }],
      }),
    );
    await api.dispose();
  }
});
