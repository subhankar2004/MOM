/**
 * Indian mobile numbers. Stored everywhere in E.164 form: "+91" + 10 digits starting with 6–9.
 * The same pattern is enforced by a CHECK constraint in the database.
 */
export const INDIAN_MOBILE_E164_PATTERN = String.raw`^\+91[6-9][0-9]{9}$`;
const E164 = new RegExp(INDIAN_MOBILE_E164_PATTERN);

export function isIndianMobileE164(value: string): boolean {
  return E164.test(value);
}

/**
 * Turns what a person types into E.164, or returns null if it isn't a valid Indian mobile.
 * Accepts: "98765 43210", "098765-43210", "+91 98765 43210", "919876543210".
 */
export function normalizeIndianMobile(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(digits)) return null;
  let national: string;
  if (/^\+91\d{10}$/.test(digits) || /^91\d{10}$/.test(digits)) national = digits.slice(-10);
  else if (/^0\d{10}$/.test(digits)) national = digits.slice(1);
  else if (/^\d{10}$/.test(digits)) national = digits;
  else return null;
  const e164 = `+91${national}`;
  return isIndianMobileE164(e164) ? e164 : null;
}
