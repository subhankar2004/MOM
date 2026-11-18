import { createHmac, timingSafeEqual } from 'node:crypto';

function safeEqualHex(expectedHex: string, given: string): boolean {
  const a = Buffer.from(expectedHex, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Razorpay Checkout success: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret).
 * Proves the payment really happened for this Razorpay order (the browser can't forge it).
 */
export function verifyCheckoutSignature(
  keySecret: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
): boolean {
  const expected = createHmac('sha256', keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  return safeEqualHex(expected, signature);
}

/** Webhooks: X-Razorpay-Signature = HMAC_SHA256(raw request body, webhook_secret). */
export function verifyWebhookSignature(webhookSecret: string, rawBody: string, signature: string): boolean {
  const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}
