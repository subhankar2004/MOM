import type { Page } from '@playwright/test';
import { E2E_RAZORPAY_SECRET } from './env';

/**
 * Replaces Razorpay Checkout with a stand-in for browser tests. "Paying" signs
 * order_id|payment_id with the test key secret — exactly what Razorpay does — so the real
 * server-side signature check runs. window.__rzpMode = 'dismiss' makes the next open() close.
 */
export async function stubRazorpay(page: Page) {
  await page.route('https://checkout.razorpay.com/v1/checkout.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.Razorpay = class {
          constructor(options) { this.options = options; }
          on() {}
          async open() {
            window.__rzpOpened = (window.__rzpOpened || 0) + 1;
            window.__rzpLastOptions = this.options;
            if (window.__rzpMode === 'dismiss') { window.__rzpMode = 'pay'; setTimeout(() => this.options.modal.ondismiss(), 50); return; }
            const paymentId = 'pay_e2e' + Math.random().toString(36).slice(2, 10);
            const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(${JSON.stringify(E2E_RAZORPAY_SECRET)}),
              { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
            const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(this.options.order_id + '|' + paymentId));
            const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
            setTimeout(() => this.options.handler({ razorpay_order_id: this.options.order_id, razorpay_payment_id: paymentId, razorpay_signature: hex }), 50);
          }
        };`,
    }),
  );
}
