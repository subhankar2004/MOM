/**
 * Money helpers. RULE: every amount in MOM is an integer number of **paise**
 * (₹137.80 → 13780). Floats are never used for money.
 *
 * Fee rates are stored in **basis points** (1 bp = 0.01 %), so 1 % = 100 bps and
 * 5 % = 500 bps. That keeps the fee maths in integers too.
 */

export type PaymentMethod = 'upi' | 'cash';

const BPS_PER_UNIT = 10_000;
/** Upper bound for a single amount: ₹1 crore. Far above any order, well inside safe integers. */
export const MAX_PAISE = 1_000_000_000;

export function assertPaise(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PAISE) {
    throw new RangeError(`${label} must be a whole number of paise between 0 and ${MAX_PAISE}`);
  }
}

function assertBps(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > BPS_PER_UNIT) {
    throw new RangeError(`${label} must be whole basis points between 0 and ${BPS_PER_UNIT}`);
  }
}

/**
 * Converts a rupee amount to paise without floating-point surprises.
 * Accepts numbers (`130`, `137.8`) or strings (`"137.80"`, `"1,37,800"` is rejected —
 * pass plain digits). At most 2 decimal places.
 */
export function paise(rupees: number | string): number {
  const text = typeof rupees === 'number' ? String(rupees) : rupees.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new RangeError(`"${text}" is not a valid rupee amount (use e.g. 130 or 137.80)`);
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const result = whole * 100 + fraction;
  assertPaise(result);
  return result;
}

/**
 * Fee for an amount at a rate in basis points, rounded half-up to the nearest paisa.
 * Integer-only: round_half_up(amount × bps / 10 000).
 */
export function feeFromBps(amountPaise: number, bps: number): number {
  assertPaise(amountPaise);
  assertBps(bps, 'fee rate');
  return Math.floor((amountPaise * bps + BPS_PER_UNIT / 2) / BPS_PER_UNIT);
}

export interface FeeRates {
  /** Charged on every order (UPI and cash). Default 100 bps = 1 %. */
  platformFeeBps: number;
  /** Charged only on cash orders. Default 500 bps = 5 %. */
  cashFeeBps: number;
}

export const DEFAULT_FEE_RATES: Readonly<FeeRates> = Object.freeze({ platformFeeBps: 100, cashFeeBps: 500 });

export interface FeeBreakdown {
  subtotalPaise: number;
  platformFeePaise: number;
  cashFeePaise: number;
  totalPaise: number;
}

/**
 * The bill for an order (spec §4.1):
 *   UPI  → subtotal + platform fee
 *   Cash → subtotal + platform fee + cash fee
 * Each fee is calculated separately on the subtotal and rounded on its own.
 */
export function calcFees(subtotalPaise: number, method: PaymentMethod, rates: FeeRates): FeeBreakdown {
  assertPaise(subtotalPaise, 'subtotal');
  if (method !== 'upi' && method !== 'cash')
    throw new RangeError(`unknown payment method "${String(method)}"`);
  const platformFeePaise = feeFromBps(subtotalPaise, rates.platformFeeBps);
  const cashFeePaise = method === 'cash' ? feeFromBps(subtotalPaise, rates.cashFeeBps) : 0;
  return {
    subtotalPaise,
    platformFeePaise,
    cashFeePaise,
    totalPaise: subtotalPaise + platformFeePaise + cashFeePaise,
  };
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const inrWholeFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Formats paise as Indian rupees with lakh grouping: 13780 → "₹137.80", 10000000 → "₹1,00,000.00".
 * With `{ compact: true }`, whole-rupee amounts drop the ".00" (menu prices: "₹80").
 */
export function formatINR(amountPaise: number, options: { compact?: boolean } = {}): string {
  if (!Number.isSafeInteger(amountPaise)) throw new RangeError('amount must be a whole number of paise');
  const negative = amountPaise < 0;
  const abs = Math.abs(amountPaise);
  const formatted =
    options.compact && abs % 100 === 0 ? inrWholeFormatter.format(abs / 100) : inrFormatter.format(abs / 100);
  return negative ? `-${formatted}` : formatted;
}

/** Human-readable rate: 100 → "1%", 250 → "2.5%". */
export function formatBps(bps: number): string {
  assertBps(bps, 'rate');
  return `${bps / 100}%`;
}
