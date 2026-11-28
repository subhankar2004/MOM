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

  // ── Route: a linked account per stall, so UPI money can be paid out to it (spec §4.2) ──
  /** Creates the stall's linked account. Returns its id (acc_…). */
  createLinkedAccount(input: LinkedAccountInput): Promise<{ id: string }>;
  /** The person behind the account (one per linked account). */
  addStakeholder(accountId: string, input: { name: string; email: string }): Promise<void>;
  /** Asks for the Route product; returns the product configuration id (acc_prd_…). */
  requestRoute(accountId: string): Promise<RouteProduct>;
  /** Where Razorpay pays the stall. Bank details go to Razorpay only; MOM never stores them. */
  setSettlementAccount(accountId: string, productId: string, bank: BankAccount): Promise<RouteProduct>;
  fetchRoute(accountId: string, productId: string): Promise<RouteProduct>;

  // ── Route transfers: pay a stall its share of a UPI payment (spec §4.2 step 6) ──
  /** Moves `amountPaise` of a captured payment to the stall's linked account, held until released. */
  createTransfer(
    paymentId: string,
    input: { account: string; amountPaise: number; orderId: string },
  ): Promise<RouteTransfer>;
  /** Transfers already made from a payment (to adopt one if our record of it was lost). */
  listTransfers(paymentId: string): Promise<RouteTransfer[]>;
  /** Lets Razorpay settle a held transfer to the stall's bank. */
  releaseTransfer(transferId: string): Promise<void>;
  /** Takes a transfer back from the stall (the order was refunded). Returns the reversal id. */
  reverseTransfer(transferId: string, amountPaise: number): Promise<{ id: string }>;
}

export interface RouteTransfer {
  id: string;
  amountPaise: number;
  onHold: boolean;
  /** MOM order id we put in the transfer's notes. */
  orderId: string | null;
}

export interface LinkedAccountInput {
  email: string;
  /** 10-digit mobile, no +91 */
  phone: string;
  legalBusinessName: string;
  businessType: 'individual' | 'proprietorship';
  contactName: string;
  address: { street1: string; street2?: string; city: string; state: string; postalCode: string };
}

export interface BankAccount {
  accountNumber: string;
  ifsc: string;
  beneficiaryName: string;
}

export type RouteActivation =
  'requested' | 'needs_clarification' | 'under_review' | 'activated' | 'suspended';

export interface RouteProduct {
  id: string;
  activationStatus: RouteActivation;
  /** What Razorpay still needs, e.g. "settlements.ifsc_code: field_missing". */
  requirements: string[];
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

  private async call<T>(path: string, body: unknown, method: 'POST' | 'PATCH' | 'GET' = 'POST'): Promise<T> {
    // Route's account APIs live under /v2.
    const url = path.startsWith('/v2/')
      ? `${this.baseUrl.replace(/\/v1$/, '')}${path}`
      : `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(body),
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

  async createLinkedAccount(input: LinkedAccountInput) {
    const account = await this.call<{ id: string }>('/v2/accounts', {
      type: 'route',
      email: input.email,
      phone: input.phone,
      legal_business_name: input.legalBusinessName,
      business_type: input.businessType,
      contact_name: input.contactName,
      profile: {
        category: 'food',
        subcategory: 'food_court',
        addresses: {
          registered: {
            street1: input.address.street1,
            street2: input.address.street2 || input.address.street1,
            city: input.address.city,
            state: input.address.state,
            postal_code: input.address.postalCode,
            country: 'IN',
          },
        },
      },
    });
    return { id: account.id };
  }

  async addStakeholder(accountId: string, input: { name: string; email: string }) {
    await this.call(`/v2/accounts/${encodeURIComponent(accountId)}/stakeholders`, input);
  }

  async requestRoute(accountId: string) {
    return toRouteProduct(
      await this.call<RawRouteProduct>(`/v2/accounts/${encodeURIComponent(accountId)}/products`, {
        product_name: 'route',
        tnc_accepted: true,
      }),
    );
  }

  async setSettlementAccount(accountId: string, productId: string, bank: BankAccount) {
    return toRouteProduct(
      await this.call<RawRouteProduct>(
        `/v2/accounts/${encodeURIComponent(accountId)}/products/${encodeURIComponent(productId)}/`,
        {
          settlements: {
            account_number: bank.accountNumber,
            ifsc_code: bank.ifsc,
            beneficiary_name: bank.beneficiaryName,
          },
          tnc_accepted: true,
        },
        'PATCH',
      ),
    );
  }

  async createTransfer(paymentId: string, input: { account: string; amountPaise: number; orderId: string }) {
    const res = await this.call<{ items: RawTransfer[] }>(
      `/payments/${encodeURIComponent(paymentId)}/transfers`,
      {
        transfers: [
          {
            account: input.account,
            amount: input.amountPaise,
            currency: 'INR',
            // Held until the student collects the food (released then, reversed if refunded).
            on_hold: true,
            notes: { mom_order_id: input.orderId },
            linked_account_notes: ['mom_order_id'],
          },
        ],
      },
    );
    return toTransfer(res.items[0]!);
  }

  async listTransfers(paymentId: string) {
    const res = await this.call<{ items: RawTransfer[] }>(
      `/payments/${encodeURIComponent(paymentId)}/transfers`,
      undefined,
      'GET',
    );
    return res.items.map(toTransfer);
  }

  async releaseTransfer(transferId: string) {
    await this.call(`/transfers/${encodeURIComponent(transferId)}`, { on_hold: false }, 'PATCH');
  }

  async reverseTransfer(transferId: string, amountPaise: number) {
    const reversal = await this.call<{ id: string }>(
      `/transfers/${encodeURIComponent(transferId)}/reversals`,
      {
        amount: amountPaise,
      },
    );
    return { id: reversal.id };
  }

  async fetchRoute(accountId: string, productId: string) {
    return toRouteProduct(
      await this.call<RawRouteProduct>(
        `/v2/accounts/${encodeURIComponent(accountId)}/products/${encodeURIComponent(productId)}/`,
        undefined,
        'GET',
      ),
    );
  }
}

interface RawTransfer {
  id: string;
  amount: number;
  on_hold?: boolean;
  notes?: Record<string, string> | unknown[];
}

function toTransfer(raw: RawTransfer): RouteTransfer {
  const notes = raw.notes && !Array.isArray(raw.notes) ? raw.notes : {};
  return {
    id: raw.id,
    amountPaise: raw.amount,
    onHold: raw.on_hold ?? false,
    orderId: notes.mom_order_id ?? null,
  };
}

interface RawRouteProduct {
  id: string;
  activation_status: RouteActivation;
  requirements?: Array<{ field_reference?: string; reason_code?: string }>;
}

function toRouteProduct(raw: RawRouteProduct): RouteProduct {
  return {
    id: raw.id,
    activationStatus: raw.activation_status,
    requirements: (raw.requirements ?? []).map(
      (r) => `${r.field_reference ?? 'unknown'}: ${r.reason_code ?? ''}`,
    ),
  };
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

  /** Linked accounts made so far (tests inspect them; bank details are kept only here). */
  readonly accounts = new Map<
    string,
    { input: LinkedAccountInput; stakeholders: number; bank?: BankAccount }
  >();
  /** Set to make the next Route call fail (tests of partial setup). */
  failNext: string | null = null;

  private maybeFail() {
    if (this.failNext) {
      const message = this.failNext;
      this.failNext = null;
      throw new PaymentGatewayError(message, 400);
    }
  }

  async createLinkedAccount(input: LinkedAccountInput) {
    this.maybeFail();
    const id = `acc_fake${randomBytes(5).toString('hex')}`;
    this.accounts.set(id, { input, stakeholders: 0 });
    return { id };
  }

  async addStakeholder(accountId: string) {
    this.maybeFail();
    const account = this.accounts.get(accountId);
    if (!account) throw new PaymentGatewayError('Linked account does not exist', 400);
    if (account.stakeholders >= 1) {
      throw new PaymentGatewayError('Stakeholders cannot be more than one for Route product.', 400);
    }
    account.stakeholders++;
  }

  async requestRoute(accountId: string) {
    this.maybeFail();
    return {
      id: `acc_prd_fake_${accountId}`,
      activationStatus: 'needs_clarification' as const,
      requirements: [],
    };
  }

  async setSettlementAccount(accountId: string, productId: string, bank: BankAccount) {
    this.maybeFail();
    this.accounts.get(accountId)!.bank = bank;
    return { id: productId, activationStatus: 'under_review' as const, requirements: [] };
  }

  /** Transfers made so far, by id (tests inspect them). */
  readonly transfers = new Map<
    string,
    {
      paymentId: string;
      account: string;
      amountPaise: number;
      orderId: string;
      onHold: boolean;
      reversed: number;
    }
  >();

  async createTransfer(paymentId: string, input: { account: string; amountPaise: number; orderId: string }) {
    this.maybeFail();
    const id = `trf_fake${randomBytes(6).toString('hex')}`;
    this.transfers.set(id, { paymentId, ...input, onHold: true, reversed: 0 });
    return { id, amountPaise: input.amountPaise, onHold: true, orderId: input.orderId };
  }

  async listTransfers(paymentId: string) {
    this.maybeFail();
    return [...this.transfers.entries()]
      .filter(([, t]) => t.paymentId === paymentId)
      .map(([id, t]) => ({ id, amountPaise: t.amountPaise, onHold: t.onHold, orderId: t.orderId }));
  }

  async releaseTransfer(transferId: string) {
    this.maybeFail();
    const t = this.transfers.get(transferId);
    if (!t) throw new PaymentGatewayError('invalid transfer_id', 400);
    t.onHold = false;
  }

  async reverseTransfer(transferId: string, amountPaise: number) {
    this.maybeFail();
    const t = this.transfers.get(transferId);
    if (!t) throw new PaymentGatewayError('invalid transfer_id', 400);
    t.reversed += amountPaise;
    return { id: `rvrsl_fake${randomBytes(6).toString('hex')}` };
  }

  /** Razorpay "approves" the account the first time its status is checked. */
  async fetchRoute(_accountId: string, productId: string) {
    this.maybeFail();
    return { id: productId, activationStatus: 'activated' as const, requirements: [] };
  }
}

/** The gateway for this environment, or null when UPI isn't configured. */
export function createPaymentGateway(env: {
  PAYMENTS_PROVIDER: 'razorpay' | 'fake' | 'test';
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
}): PaymentGateway | null {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return null;
  return env.PAYMENTS_PROVIDER !== 'razorpay'
    ? new FakeGateway(env.RAZORPAY_KEY_ID)
    : new RazorpayGateway(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET);
}
