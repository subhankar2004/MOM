import { randomBytes } from 'node:crypto';

/** What MOM needs from a payment gateway. Razorpay in real use; a fake in automated tests. */
export interface PaymentGateway {
  readonly name: 'razorpay' | 'fake';
  /** Public key id the browser's Checkout needs (safe to send to clients). */
  readonly keyId: string;
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<{ id: string }>;
  refund(input: {
    paymentId: string;
    amountPaise: number;
    notes: Record<string, string>;
  }): Promise<{ id: string; status: 'processed' | 'pending' | 'failed' }>;
}

export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'PaymentGatewayError';
  }
}

/** Razorpay REST API (https://api.razorpay.com/v1) with HTTP Basic auth. No SDK needed. */
export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay' as const;
  private readonly auth: string;

  constructor(
    readonly keyId: string,
    keySecret: string,
    private readonly baseUrl = 'https://api.razorpay.com/v1',
  ) {
    this.auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new PaymentGatewayError(`Razorpay unreachable: ${(err as Error).message}`);
    }
    const data = (await res.json().catch(() => ({}))) as { error?: { description?: string } };
    if (!res.ok)
      throw new PaymentGatewayError(data.error?.description ?? `Razorpay error ${res.status}`, res.status);
    return data as T;
  }

  async createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
    const order = await this.call<{ id: string }>('/orders', {
      amount: input.amountPaise,
      currency: 'INR',
      receipt: input.receipt.slice(0, 40),
      notes: input.notes,
    });
    return { id: order.id };
  }

  async refund(input: { paymentId: string; amountPaise: number; notes: Record<string, string> }) {
    const refund = await this.call<{ id: string; status: 'processed' | 'pending' | 'failed' }>(
      `/payments/${encodeURIComponent(input.paymentId)}/refund`,
      { amount: input.amountPaise, speed: 'normal', notes: input.notes },
    );
    return { id: refund.id, status: refund.status };
  }
}

/**
 * Offline stand-in for automated tests and demos without network: makes up order and
 * refund ids. Refused by env validation on staging/production.
 */
export class FakeGateway implements PaymentGateway {
  readonly name = 'fake' as const;
  readonly refunds: Array<{ paymentId: string; amountPaise: number }> = [];
  constructor(readonly keyId = 'rzp_test_fake') {}
  async createOrder() {
    return { id: `order_fake${randomBytes(7).toString('hex')}` };
  }
  async refund(input: { paymentId: string; amountPaise: number }) {
    this.refunds.push(input);
    return { id: `rfnd_fake${randomBytes(7).toString('hex')}`, status: 'processed' as const };
  }
}

/** The gateway for this environment, or null when UPI isn't configured. */
export function createPaymentGateway(env: {
  PAYMENTS_PROVIDER: 'razorpay' | 'fake';
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
}): PaymentGateway | null {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return null;
  return env.PAYMENTS_PROVIDER === 'fake'
    ? new FakeGateway(env.RAZORPAY_KEY_ID)
    : new RazorpayGateway(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET);
}
