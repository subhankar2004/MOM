import { describe, expect, it } from 'vitest';
import { pickupQrPayload, verifyPickupQr } from './pickup-qr.js';

const SECRET = 'q'.repeat(40);
const ORDER = '01a1ed75-fbda-7e66-8841-312a323c2a07';

describe('pickup QR', () => {
  it('round-trips: a genuine payload gives back the order id', () => {
    const payload = pickupQrPayload(SECRET, ORDER);
    expect(payload).toMatch(/^MOM1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/);
    expect(payload.length).toBeLessThanOrEqual(64); // small QR → quick scan
    expect(verifyPickupQr(SECRET, payload)).toBe(ORDER);
    expect(verifyPickupQr(SECRET, `  ${payload}\n`)).toBe(ORDER); // scanner whitespace
  });

  it('a tampered payload fails (acceptance)', () => {
    const payload = pickupQrPayload(SECRET, ORDER);
    const otherOrder = '01a1ed75-fbda-7e66-8841-312a323c2a08';
    const [, , sig] = payload.split('.');
    // someone else's order id with this signature
    expect(verifyPickupQr(SECRET, `MOM1.${otherOrder}.${sig}`)).toBeNull();
    // one character of the signature changed
    const flipped = payload.slice(0, -1) + (payload.endsWith('A') ? 'B' : 'A');
    expect(verifyPickupQr(SECRET, flipped)).toBeNull();
    // signed with another secret
    expect(verifyPickupQr(SECRET, pickupQrPayload('x'.repeat(40), ORDER))).toBeNull();
  });

  it.each([
    '',
    'MOM1',
    `MOM2.${ORDER}.abc`,
    `MOM1.not-a-uuid.abc`,
    `MOM1.${ORDER}`,
    `MOM1.${ORDER}.a.b`,
    'https://evil.example',
  ])('rejects malformed %j', (payload) => {
    expect(verifyPickupQr(SECRET, payload)).toBeNull();
  });
});
