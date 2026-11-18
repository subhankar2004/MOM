import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The pickup QR code (spec §5): `MOM1.<orderId>.<signature>`.
 * The signature is HMAC-SHA256(QR_SECRET, "MOM1.<orderId>") cut to 128 bits, base64url —
 * enough to make guessing impossible while keeping the code small (≈64 characters), so it
 * scans quickly from a phone screen. Only the server knows QR_SECRET: a QR can't be forged,
 * and changing one character makes it invalid.
 */
const PREFIX = 'MOM1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sign(secret: string, orderId: string): string {
  return createHmac('sha256', secret)
    .update(`${PREFIX}.${orderId}`)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

export function pickupQrPayload(secret: string, orderId: string): string {
  return `${PREFIX}.${orderId}.${sign(secret, orderId)}`;
}

/** Returns the order id if the payload is genuine, otherwise null. */
export function verifyPickupQr(secret: string, payload: string): string | null {
  const parts = payload.trim().split('.');
  if (parts.length !== 3) return null;
  const [prefix, orderId, signature] = parts as [string, string, string];
  if (prefix !== PREFIX || !UUID.test(orderId)) return null;
  const expected = Buffer.from(sign(secret, orderId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? orderId : null;
}
