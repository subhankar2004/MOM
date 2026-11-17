import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { generateOtp, hashOtp, otpMatches, otpMessage } from './otp.js';
import { hashRefreshToken, newRefreshToken, signAccessToken, verifyAccessToken } from './tokens.js';

const PEPPER = 'p'.repeat(40);
const SECRET = 's'.repeat(40);

describe('OTP codes', () => {
  it('are 6 digits, leading zeros kept, and vary', () => {
    const codes = Array.from({ length: 2000 }, generateOtp);
    expect(codes.every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(1990);
  });

  it('match only for the same phone, code and pepper', () => {
    const hash = hashOtp(PEPPER, '+919876543210', '012345');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('012345');
    expect(otpMatches(PEPPER, '+919876543210', '012345', hash)).toBe(true);
    expect(otpMatches(PEPPER, '+919876543210', '012346', hash)).toBe(false);
    expect(otpMatches(PEPPER, '+919876543211', '012345', hash)).toBe(false); // bound to the phone
    expect(otpMatches('x'.repeat(40), '+919876543210', '012345', hash)).toBe(false);
    expect(otpMatches(PEPPER, '+919876543210', '012345', 'not-hex')).toBe(false);
  });

  it('SMS text carries the code and validity', () => {
    expect(otpMessage('482913', 5)).toBe(
      '482913 is your MOM login code. It is valid for 5 minutes. Do not share it with anyone.',
    );
  });
});

describe('access tokens', () => {
  it('round-trip user id and role', async () => {
    const { token, expiresAt } = await signAccessToken(SECRET, { userId: 'u-1', role: 'student' }, 900);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 890_000);
    expect(await verifyAccessToken(SECRET, token)).toEqual({
      ok: true,
      claims: { userId: 'u-1', role: 'student' },
    });
  });

  it('reject a wrong secret, tampering and garbage', async () => {
    const { token } = await signAccessToken(SECRET, { userId: 'u-1', role: 'student' }, 900);
    expect(await verifyAccessToken('w'.repeat(40), token)).toEqual({ ok: false, reason: 'invalid' });
    const [h, p, s] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), role: 'super_admin' }),
    ).toString('base64url');
    expect(await verifyAccessToken(SECRET, `${h}.${forged}.${s}`)).toEqual({ ok: false, reason: 'invalid' });
    expect(await verifyAccessToken(SECRET, 'not.a.jwt')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('report expiry separately (so the client refreshes)', async () => {
    const { token } = await signAccessToken(SECRET, { userId: 'u-1', role: 'student' }, -10);
    expect(await verifyAccessToken(SECRET, token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuse "alg: none" and unknown roles', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        sub: 'u-1',
        role: 'super_admin',
        iss: 'mom-api',
        aud: 'mom',
        exp: Math.floor(Date.now() / 1000) + 600,
      }),
    ).toString('base64url');
    expect(await verifyAccessToken(SECRET, `${header}.${body}.`)).toEqual({ ok: false, reason: 'invalid' });

    const weird = await new SignJWT({ role: 'god' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u-1')
      .setIssuer('mom-api')
      .setAudience('mom')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyAccessToken(SECRET, weird)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('refresh tokens', () => {
  it('are 256-bit random and stored only as a hash', () => {
    const a = newRefreshToken();
    const b = newRefreshToken();
    expect(a.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).toBe(hashRefreshToken(a.raw));
    expect(a.hash).not.toContain(a.raw);
  });
});
