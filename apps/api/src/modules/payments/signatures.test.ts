import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyCheckoutSignature, verifyWebhookSignature } from './signatures.js';

const SECRET = 'test_key_secret';

describe('Razorpay signatures', () => {
  const sign = (s: string, secret = SECRET) => createHmac('sha256', secret).update(s).digest('hex');

  it('checkout: accepts the real signature, rejects tampering', () => {
    const good = sign('order_A|pay_B');
    expect(verifyCheckoutSignature(SECRET, 'order_A', 'pay_B', good)).toBe(true);
    expect(verifyCheckoutSignature(SECRET, 'order_A', 'pay_C', good)).toBe(false); // other payment
    expect(verifyCheckoutSignature(SECRET, 'order_X', 'pay_B', good)).toBe(false); // other order
    expect(verifyCheckoutSignature('other_secret', 'order_A', 'pay_B', good)).toBe(false);
    expect(verifyCheckoutSignature(SECRET, 'order_A', 'pay_B', 'not-a-signature')).toBe(false);
    expect(verifyCheckoutSignature(SECRET, 'order_A', 'pay_B', '')).toBe(false);
  });

  it('webhook: signature over the exact raw body', () => {
    const body = '{"event":"payment.captured","payload":{}}';
    expect(verifyWebhookSignature(SECRET, body, sign(body))).toBe(true);
    expect(verifyWebhookSignature(SECRET, `${body} `, sign(body))).toBe(false); // any byte changed
    expect(verifyWebhookSignature(SECRET, body, sign(body, 'wrong'))).toBe(false);
  });
});
