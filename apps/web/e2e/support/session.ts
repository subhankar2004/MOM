import type { BrowserContext } from '@playwright/test';
import { API_URL, TEST_CODE, WEB_URL } from './env';

/**
 * Signs a browser context in as `phone` through the real API (test phones get TEST_CODE).
 * context.request shares cookies with the browser, so the pages are signed in too.
 */
export async function signIn(context: BrowserContext, phone: string, name = 'Order Tester') {
  const headers = { origin: WEB_URL };
  const req = await context.request.post(`${API_URL}/v1/auth/otp/request`, { data: { phone }, headers });
  if (!req.ok() && req.status() !== 429) throw new Error(`otp request ${req.status()} ${await req.text()}`);
  const verify = await context.request.post(`${API_URL}/v1/auth/otp/verify`, {
    data: { phone, code: TEST_CODE },
    headers,
  });
  if (!verify.ok()) throw new Error(`otp verify ${verify.status()} ${await verify.text()}`);
  await context.request.patch(`${API_URL}/v1/me`, { data: { name }, headers });
  await context.addInitScript(() => localStorage.setItem('mom.session', '1'));
}
