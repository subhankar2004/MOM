import type { BrowserContext } from '@playwright/test';
import { API_URL, TEST_CODE, WEB_URL } from './env';

/**
 * Signs a browser context in as `phone` through the real API (test phones get TEST_CODE).
 * context.request shares cookies with the browser, so the pages are signed in too.
 */
export async function signIn(context: BrowserContext, phone: string, name = 'Order Tester') {
  const headers = { origin: WEB_URL };
  const req = await context.request.post(`${API_URL}/v1/auth/otp/request`, { data: { phone }, headers });
  // 429 is fine only for the resend cooldown (a code was just sent); any other limit is a real failure.
  if (!req.ok()) {
    const body = await req.text();
    if (req.status() !== 429 || !body.includes('before asking for another code')) {
      throw new Error(`otp request ${req.status()} ${body}`);
    }
  }
  const verify = await context.request.post(`${API_URL}/v1/auth/otp/verify`, {
    data: { phone, code: TEST_CODE },
    headers,
  });
  if (!verify.ok()) throw new Error(`otp verify ${verify.status()} ${await verify.text()}`);
  const named = await context.request.patch(`${API_URL}/v1/me`, { data: { name }, headers });
  // Names are letters only: fail here rather than leave a nameless test user.
  if (!named.ok()) throw new Error(`setting name "${name}" failed: ${named.status()} ${await named.text()}`);
  await context.addInitScript(() => localStorage.setItem('mom.session', '1'));
}
