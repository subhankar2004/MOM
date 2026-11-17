import { eq, sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { authOtps, refreshTokens, users } from '../../db/schema/index.js';
import { createTestApp, type TestApp } from '../../test/test-app.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './cookies.js';

/**
 * Phone OTP login against the real mom_test database (each test rolled back).
 * Note: inside one transaction Postgres' now() is frozen, so "time passing" is simulated
 * by moving timestamps back with SQL.
 */
const PHONE = '+919876543210';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function start(env: Record<string, string> = {}) {
  t = await createTestApp(env);
  return t;
}

const codeFrom = (body: string) => body.match(/\b(\d{6})\b/)![1]!;

function cookie(res: LightMyRequestResponse, name: string) {
  return res.cookies.find((c) => c.name === name);
}

async function requestCode(app: TestApp, phone: string = PHONE) {
  const res = await app.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
  return { res, code: res.statusCode === 202 ? codeFrom(app.sms.at(-1)!.body) : undefined };
}

async function verify(app: TestApp, code: string, phone: string = PHONE) {
  return app.app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code } });
}

async function signIn(app: TestApp, phone: string = PHONE) {
  const { code } = await requestCode(app, phone);
  const res = await verify(app, code!, phone);
  expect(res.statusCode).toBe(200);
  return {
    res,
    access: cookie(res, ACCESS_COOKIE)!.value,
    refresh: cookie(res, REFRESH_COOKIE)!.value,
  };
}

const refresh = (app: TestApp, token: string) =>
  app.app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [REFRESH_COOKIE]: token } });

const me = (app: TestApp, access: string) =>
  app.app.inject({ method: 'GET', url: '/v1/me', cookies: { [ACCESS_COOKIE]: access } });

describe('sign-in with a phone code', () => {
  it('request → SMS → verify creates the account, sets secure cookies, and /me works', async () => {
    const app = await start();
    const { res } = await requestCode(app, '98765 43210'); // any common format
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ expiresInSeconds: 300, resendAfterSeconds: 30 });
    expect(app.sms).toHaveLength(1);
    expect(app.sms[0]!.to).toBe(PHONE);

    const [row] = await app.db.select().from(authOtps).where(eq(authOtps.phone, PHONE));
    const code = codeFrom(app.sms[0]!.body);
    expect(row!.codeHash).not.toContain(code); // only a hash is stored

    const login = await verify(app, code);
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({
      user: { phone: PHONE, name: null, role: 'student' },
      isNewUser: true,
      accessTokenExpiresAt: expect.any(String),
    });
    const at = cookie(login, ACCESS_COOKIE)!;
    const rt = cookie(login, REFRESH_COOKIE)!;
    expect(at).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(rt).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/v1/auth' });
    expect(login.body).not.toContain(at.value); // tokens only travel in cookies
    expect(login.body).not.toContain(rt.value);

    const who = await me(app, at.value);
    expect(who.statusCode).toBe(200);
    expect(who.json().user.phone).toBe(PHONE);
  });

  it('marks cookies Secure outside local development', async () => {
    const app = await start({ COOKIE_SECURE: 'true' });
    const { res } = await signIn(app);
    expect(cookie(res, ACCESS_COOKIE)!.secure).toBe(true);
    expect(cookie(res, REFRESH_COOKIE)!.secure).toBe(true);
  });

  it('first login asks for a name; after saving it, the next login does not', async () => {
    const app = await start();
    const first = await signIn(app);
    const patch = await app.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      cookies: { [ACCESS_COOKIE]: first.access },
      payload: { name: '  Asha Mohanty ' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().user.name).toBe('Asha Mohanty');

    await app.db
      .update(authOtps)
      .set({ createdAt: sql`now() - interval '1 minute'` })
      .where(eq(authOtps.phone, PHONE)); // past the resend cooldown
    const second = await signIn(app);
    expect(second.res.json()).toMatchObject({ isNewUser: false, user: { name: 'Asha Mohanty' } });
    expect(second.res.json().user.id).toBe(first.res.json().user.id);
  });

  it.each([
    ['12345', 'body.phone'],
    ['+449876543210', 'body.phone'],
  ])('rejects the phone %s with a field error', async (phone, field) => {
    const app = await start();
    const res = await app.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toEqual([{ field, message: 'Enter a 10-digit Indian mobile number' }]);
    expect(app.sms).toHaveLength(0);
  });

  it('validates names', async () => {
    const app = await start();
    const { access } = await signIn(app);
    for (const name of ['', '   ', 'x'.repeat(61), '<script>']) {
      const res = await app.app.inject({
        method: 'PATCH',
        url: '/v1/me',
        cookies: { [ACCESS_COOKIE]: access },
        payload: { name },
      });
      expect(res.statusCode, name).toBe(400);
    }
  });
});

describe('wrong, expired and reused codes', () => {
  it('counts down attempts, then locks the code — even the right code fails after 5 misses', async () => {
    const app = await start();
    const { code } = await requestCode(app);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let left = 4; left >= 1; left--) {
      const res = await verify(app, wrong);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({ code: 'OTP_INVALID', details: { attemptsLeft: left } });
    }
    const fifth = await verify(app, wrong);
    expect([fifth.statusCode, fifth.json().error.code]).toEqual([429, 'OTP_TOO_MANY_ATTEMPTS']);
    const right = await verify(app, code!);
    expect([right.statusCode, right.json().error.code]).toEqual([429, 'OTP_TOO_MANY_ATTEMPTS']);
  });

  it('rejects an expired code', async () => {
    const app = await start();
    const { code } = await requestCode(app);
    await app.db
      .update(authOtps)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(authOtps.phone, PHONE));
    const res = await verify(app, code!);
    expect([res.statusCode, res.json().error.code]).toEqual([400, 'OTP_EXPIRED']);
  });

  it('a code works only once', async () => {
    const app = await start();
    const { code } = await requestCode(app);
    expect((await verify(app, code!)).statusCode).toBe(200);
    const again = await verify(app, code!);
    expect([again.statusCode, again.json().error.code]).toEqual([400, 'OTP_EXPIRED']);
  });

  it('only the newest code counts', async () => {
    const app = await start();
    const { code: oldCode } = await requestCode(app);
    await app.db
      .update(authOtps)
      .set({ createdAt: sql`now() - interval '1 minute'` })
      .where(eq(authOtps.phone, PHONE));
    const { code: newCode } = await requestCode(app);
    if (oldCode !== newCode) expect((await verify(app, oldCode!)).json().error.code).toBe('OTP_INVALID');
    expect((await verify(app, newCode!)).statusCode).toBe(200);
  });

  it('a code for one phone does not work for another', async () => {
    const app = await start();
    const { code } = await requestCode(app);
    const res = await verify(app, code!, '+916000000000');
    expect(res.json().error.code).toBe('OTP_EXPIRED'); // that phone has no code at all
  });

  it('rejects malformed codes before touching the database', async () => {
    const app = await start();
    await requestCode(app);
    for (const code of ['12345', '1234567', 'abcdef', '']) {
      expect((await verify(app, code)).json().error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('sending limits', () => {
  it('30-second resend cooldown', async () => {
    const app = await start();
    await requestCode(app);
    const res = await app.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: PHONE },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSeconds: 30 } });
    expect(app.sms).toHaveLength(1);
  });

  it('at most 5 codes per phone per hour', async () => {
    const app = await start();
    for (let i = 0; i < 5; i++) {
      await app.db.insert(authOtps).values({
        phone: PHONE,
        codeHash: 'x',
        expiresAt: sql`now()`,
        createdAt: sql`now() - interval '10 minutes'`,
      });
    }
    const res = await app.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: PHONE },
    });
    expect([res.statusCode, res.json().error.code]).toEqual([429, 'RATE_LIMITED']);
    expect(res.json().error.message).toMatch(/an hour/);
  });

  it('at most 30 codes per network (IP) per hour, across phones', async () => {
    const app = await start();
    for (let i = 0; i < 30; i++) {
      await app.db.insert(authOtps).values({
        phone: `+9190000${String(i).padStart(5, '0')}`,
        codeHash: 'x',
        expiresAt: sql`now()`,
        ip: '127.0.0.1',
      });
    }
    const res = await app.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: PHONE },
    });
    expect([res.statusCode, res.json().error.code]).toEqual([429, 'RATE_LIMITED']);
    expect(app.sms).toHaveLength(0);
  });

  it('when the SMS provider fails: a clear 503, and the attempt does not count', async () => {
    const app = await start();
    const ok = app.sms;
    // Swap in a failing provider for one call by making the captured array throw on push.
    const failingPush = ok.push.bind(ok);
    let fail = true;
    ok.push = (...items) => {
      if (fail) throw new Error('throttled by carrier');
      return failingPush(...items);
    };
    const res = await app.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: PHONE },
    });
    expect([res.statusCode, res.json().error.code]).toEqual([503, 'SERVICE_UNAVAILABLE']);
    expect(res.body).not.toContain('throttled');
    expect(await app.db.select().from(authOtps).where(eq(authOtps.phone, PHONE))).toHaveLength(0);

    fail = false; // no cooldown: the student can retry immediately
    expect((await requestCode(app)).res.statusCode).toBe(202);
  });

  it('test phones get the fixed code and no SMS', async () => {
    const app = await start({ SMS_TEST_PHONES: '9000000001', SMS_TEST_CODE: '246810' });
    const res = await app.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: '9000000001' },
    });
    expect(res.statusCode).toBe(202);
    expect(app.sms).toHaveLength(0);
    expect((await verify(app, '246810', '+919000000001')).statusCode).toBe(200);
  });
});

describe('sessions', () => {
  it('refresh rotates both cookies', async () => {
    const app = await start();
    const s = await signIn(app);
    const r = await refresh(app, s.refresh);
    expect(r.statusCode).toBe(200);
    const newRefresh = cookie(r, REFRESH_COOKIE)!.value;
    expect(newRefresh).not.toBe(s.refresh);
    expect((await me(app, cookie(r, ACCESS_COOKIE)!.value)).statusCode).toBe(200);
  });

  it('reusing an old refresh token (theft) revokes the whole session', async () => {
    const app = await start();
    const s = await signIn(app);
    const rotated = cookie(await refresh(app, s.refresh), REFRESH_COOKIE)!.value;
    // Move the rotation outside the 10 s grace window used for parallel tabs.
    await app.db
      .update(refreshTokens)
      .set({ revokedAt: sql`now() - interval '1 minute'` })
      .where(sql`revoked_at is not null`);

    const replay = await refresh(app, s.refresh);
    expect([replay.statusCode, replay.json().error.code]).toEqual([401, 'SESSION_EXPIRED']);
    expect(cookie(replay, REFRESH_COOKIE)!.value).toBe(''); // cookies cleared
    // The legitimate (newer) token is now dead too.
    expect((await refresh(app, rotated)).statusCode).toBe(401);
  });

  it('two tabs refreshing at the same moment do not log the user out', async () => {
    const app = await start();
    const s = await signIn(app);
    const winner = cookie(await refresh(app, s.refresh), REFRESH_COOKIE)!.value;
    const loser = await refresh(app, s.refresh); // within the grace window
    expect(loser.statusCode).toBe(401);
    expect((await refresh(app, winner)).statusCode).toBe(200); // session still alive
  });

  it('logout ends the session', async () => {
    const app = await start();
    const s = await signIn(app);
    const out = await app.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      cookies: { [REFRESH_COOKIE]: s.refresh },
    });
    expect(out.statusCode).toBe(204);
    expect(cookie(out, ACCESS_COOKIE)!.value).toBe('');
    expect((await refresh(app, s.refresh)).statusCode).toBe(401);
  });

  it('expired refresh tokens are refused', async () => {
    const app = await start();
    const s = await signIn(app);
    await app.db.update(refreshTokens).set({ expiresAt: sql`now() - interval '1 second'` });
    expect((await refresh(app, s.refresh)).json().error.code).toBe('SESSION_EXPIRED');
  });

  it('/v1/me needs a valid access token (cookie or Bearer)', async () => {
    const app = await start();
    const s = await signIn(app);
    expect((await app.app.inject('/v1/me')).json().error.code).toBe('UNAUTHENTICATED');
    expect((await me(app, `${s.access}x`)).statusCode).toBe(401);
    const bearer = await app.app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${s.access}` } });
    expect(bearer.statusCode).toBe(200);
  });

  it('refresh without a cookie is a clean 401', async () => {
    const app = await start();
    const res = await app.app.inject({ method: 'POST', url: '/v1/auth/refresh' });
    expect([res.statusCode, res.json().error.code]).toEqual([401, 'SESSION_EXPIRED']);
  });
});

describe('suspended and deleted accounts', () => {
  it('a suspended user cannot sign in or refresh', async () => {
    const app = await start();
    const s = await signIn(app);
    await app.db.update(users).set({ status: 'suspended' }).where(eq(users.phone, PHONE));

    expect((await refresh(app, s.refresh)).json().error.code).toBe('ACCOUNT_SUSPENDED');
    await app.db.update(authOtps).set({ createdAt: sql`now() - interval '1 minute'` });
    const { code } = await requestCode(app);
    const res = await verify(app, code!);
    expect([res.statusCode, res.json().error.code]).toEqual([403, 'ACCOUNT_SUSPENDED']);
  });

  it('deleting the account erases phone and name, ends sessions, and frees the number', async () => {
    const app = await start();
    const s = await signIn(app);
    const oldId = s.res.json().user.id;
    const bad = await app.app.inject({
      method: 'DELETE',
      url: '/v1/me',
      cookies: { [ACCESS_COOKIE]: s.access },
    });
    expect(bad.statusCode).toBe(400); // needs {"confirm": true}

    const del = await app.app.inject({
      method: 'DELETE',
      url: '/v1/me',
      cookies: { [ACCESS_COOKIE]: s.access },
      payload: { confirm: true },
    });
    expect(del.statusCode).toBe(204);
    const [gone] = await app.db.select().from(users).where(eq(users.id, oldId));
    expect(gone).toMatchObject({ phone: null, name: null, deletedAt: expect.any(Date) });
    expect((await refresh(app, s.refresh)).statusCode).toBe(401);
    expect((await me(app, s.access)).statusCode).toBe(401);

    await app.db.update(authOtps).set({ createdAt: sql`now() - interval '1 minute'` });
    const again = await signIn(app);
    expect(again.res.json()).toMatchObject({ isNewUser: true });
    expect(again.res.json().user.id).not.toBe(oldId);
  });
});

describe('cross-site protection', () => {
  it('blocks state-changing requests from other websites', async () => {
    const app = await start({ WEB_ORIGIN: 'https://mom.example' });
    const evil = await app.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      headers: { origin: 'https://evil.example' },
      payload: { phone: PHONE },
    });
    expect([evil.statusCode, evil.json().error.code]).toEqual([403, 'FORBIDDEN']);

    const sneaky = await app.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(sneaky.statusCode).toBe(403);

    const ok = await app.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      headers: { origin: 'https://mom.example' },
      payload: { phone: PHONE },
    });
    expect(ok.statusCode).toBe(202);
    expect(app.sms).toHaveLength(1);
  });
});
